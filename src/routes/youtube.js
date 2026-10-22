import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as youtubeService from '../services/youtubeService.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const uploadJobs = new Map();
const chunkBody = express.raw({ type: 'application/octet-stream', limit: '20mb' });

const publicJob = (job) => ({
  status: job.status,
  success: job.success,
  ...(job.videoId ? { videoId: job.videoId, youtubeUrl: job.youtubeUrl } : {}),
  ...(job.error ? { error: job.error } : {}),
});

const cleanupJobFiles = async (job) => {
  if (job.filePath) await fsPromises.unlink(job.filePath).catch(() => {});
  if (job.chunkDir) await fsPromises.rm(job.chunkDir, { recursive: true, force: true }).catch(() => {});
};

const startYouTubeUpload = (jobId, filePath, title, description, chunkDir) => {
  const job = uploadJobs.get(jobId);
  if (!job) return;
  job.status = 'processing';
  job.filePath = filePath;
  job.chunkDir = chunkDir;

  void (async () => {
    try {
      const data = await youtubeService.uploadVideoToYouTube(filePath, title, description);
      uploadJobs.set(jobId, {
        status: 'complete',
        success: true,
        videoId: data.id,
        youtubeUrl: `https://youtube.com/watch?v=${data.id}`,
      });
    } catch (error) {
      console.error('[YouTube upload] Failed:', error?.message || 'Unknown error');
      uploadJobs.set(jobId, { status: 'failed', success: false, error: error.message || 'YouTube upload failed' });
    } finally {
      await cleanupJobFiles({ filePath, chunkDir });
    }
  })();
};

router.get('/auth/youtube', (req, res) => {
  res.redirect(youtubeService.getAuthUrl());
});

router.get('/auth/youtube/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const tokens = await youtubeService.setCredentials(code);
    res.send(`
      <html>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h2 style="color: green;">YouTube Authorization Successful!</h2>
          <p>You can close this tab. Your refresh token is displayed below for production environment variables:</p>
          <textarea style="width: 100%; max-width: 600px; height: 100px;" readonly>${tokens.refresh_token || 'Access token stored successfully.'}</textarea>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send('Authorization failed: ' + error.message);
  }
});

router.get('/api/youtube/status', async (req, res) => {
  const status = await youtubeService.getStatus();
  res.json(status);
});

router.post('/api/youtube/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file provided' });
  const jobId = randomUUID();
  uploadJobs.set(jobId, { status: 'processing', success: false });

  const cleanupTimer = setTimeout(() => uploadJobs.delete(jobId), 60 * 60 * 1000);
  cleanupTimer.unref?.();
  startYouTubeUpload(jobId, req.file.path, req.body.title || 'MarketMix Property Tour', req.body.description || '');

  return res.status(202).json({ success: true, jobId, status: 'processing' });
});

router.post('/api/youtube/upload/init', async (req, res) => {
  const totalChunks = Number(req.body?.totalChunks);
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 10000) {
    return res.status(400).json({ error: 'totalChunks must be a positive integer' });
  }
  const jobId = randomUUID();
  const chunkDir = path.join('uploads', 'chunks', jobId);
  await fsPromises.mkdir(chunkDir, { recursive: true });
  uploadJobs.set(jobId, {
    status: 'uploading',
    success: false,
    totalChunks,
    receivedChunks: 0,
    chunkDir,
    title: req.body.title || 'MarketMix Property Tour',
    description: req.body.description || '',
  });
  const cleanupTimer = setTimeout(() => uploadJobs.delete(jobId), 2 * 60 * 60 * 1000);
  cleanupTimer.unref?.();
  return res.status(201).json({ success: true, jobId, status: 'uploading', totalChunks });
});

router.put('/api/youtube/upload/:jobId/chunk', chunkBody, async (req, res) => {
  const job = uploadJobs.get(req.params.jobId);
  const index = Number(req.header('x-chunk-index'));
  if (!job || job.status !== 'uploading') return res.status(404).json({ error: 'Upload job not found or not accepting chunks' });
  if (!Number.isInteger(index) || index < 0 || index >= job.totalChunks) return res.status(400).json({ error: 'Invalid chunk index' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Empty chunk' });
  await fsPromises.writeFile(path.join(job.chunkDir, `${index}.part`), req.body);
  job.receivedChunks = new Set([...Array(job.totalChunks).keys()].filter((i) => fs.existsSync(path.join(job.chunkDir, `${i}.part`)))).size;
  return res.json({ success: true, jobId: req.params.jobId, receivedChunks: job.receivedChunks, totalChunks: job.totalChunks });
});

router.post('/api/youtube/upload/:jobId/complete', async (req, res) => {
  const job = uploadJobs.get(req.params.jobId);
  if (!job || job.status !== 'uploading') return res.status(404).json({ error: 'Upload job not found or already completed' });
  const parts = [];
  for (let index = 0; index < job.totalChunks; index += 1) {
    const part = path.join(job.chunkDir, `${index}.part`);
    if (!fs.existsSync(part)) return res.status(409).json({ error: `Missing chunk ${index}` });
    parts.push(part);
  }
  const filePath = path.join('uploads', `${req.params.jobId}.video`);
  const output = fs.createWriteStream(filePath);
  try {
    for (const part of parts) await pipeline(fs.createReadStream(part), output, { end: false });
    output.end();
    await new Promise((resolve, reject) => { output.once('close', resolve); output.once('error', reject); });
  } catch (error) {
    output.destroy();
    await cleanupJobFiles({ filePath, chunkDir });
    return res.status(500).json({ error: `Could not assemble upload: ${error.message}` });
  }
  startYouTubeUpload(req.params.jobId, filePath, job.title, job.description, job.chunkDir);
  return res.status(202).json({ success: true, jobId: req.params.jobId, status: 'processing' });
});

router.get('/api/youtube/upload/:jobId', (req, res) => {
  const job = uploadJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Upload job not found or expired' });
  return res.json(publicJob(job));
});

export default router;
