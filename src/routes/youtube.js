import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import * as youtubeService from '../services/youtubeService.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });
const uploadJobs = new Map();

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

  void (async () => {
    try {
      const data = await youtubeService.uploadVideoToYouTube(
        req.file.path,
        req.body.title || 'MarketMix Property Tour',
        req.body.description || ''
      );
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
      await fsPromises.unlink(req.file.path).catch(() => {});
    }
  })();

  return res.status(202).json({ success: true, jobId, status: 'processing' });
});

router.get('/api/youtube/upload/:jobId', (req, res) => {
  const job = uploadJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Upload job not found or expired' });
  return res.json(job);
});

export default router;
