import { getAdminFirestore } from './adminFirebase.js';

const DEFAULT_ORIGINS = [
  'https://marketmix-realestates.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
];
const PRIMARY_ORIGIN = 'https://marketmix-realestates.vercel.app';

const environmentOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

let allowedOrigins = new Set([...DEFAULT_ORIGINS, ...environmentOrigins]);

export const loadAllowedOrigins = async () => {
  try {
    const snapshot = await getAdminFirestore().collection('settings').doc('youtubeServer').get();
    if (snapshot.exists && Array.isArray(snapshot.data()?.allowedOrigins)) {
      allowedOrigins = new Set([PRIMARY_ORIGIN, ...snapshot.data().allowedOrigins]);
    }
  } catch (error) {
    console.warn('[CORS] Could not load Firestore origin settings; using defaults:', error.message);
  }
};

export const getAllowedOrigins = () => [...allowedOrigins];

export const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^https:\/\/marketmix-realestates(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
};

export const saveAllowedOrigins = async (origins) => {
  const safeOrigins = [...new Set([PRIMARY_ORIGIN, ...origins])];
  await getAdminFirestore().collection('settings').doc('youtubeServer').set({
    allowedOrigins: safeOrigins,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  allowedOrigins = new Set(safeOrigins);
  return getAllowedOrigins();
};

export const normalizeAllowedOrigins = (input) => {
  if (!Array.isArray(input) || input.length > 50) {
    throw new Error('Provide an array of no more than 50 website origins');
  }

  const normalized = new Set();
  for (const value of input) {
    if (typeof value !== 'string') throw new Error('Every origin must be a URL');
    const url = new URL(value.trim());
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.origin !== value.trim()) {
      throw new Error(`Invalid origin: ${value}. Use a secure URL origin without a path.`);
    }
    normalized.add(url.origin);
  }

  return [...normalized];
};