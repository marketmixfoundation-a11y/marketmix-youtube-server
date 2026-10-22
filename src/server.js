import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import youtubeRoutes from './routes/youtube.js';
import adminSettingsRoutes from './routes/adminSettings.js';
import { isOriginAllowed, loadAllowedOrigins } from './services/originSettings.js';

const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
  allowedHeaders: ['Authorization', 'Content-Type'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'marketmix-youtube-server' });
});

app.use('/', youtubeRoutes);
app.use('/', adminSettingsRoutes);

const server = app.listen(PORT, () => {
  console.log(`YouTube Server running on http://localhost:${PORT}`);
});
server.requestTimeout = 20 * 60 * 1000;
server.headersTimeout = 21 * 60 * 1000;
loadAllowedOrigins();
