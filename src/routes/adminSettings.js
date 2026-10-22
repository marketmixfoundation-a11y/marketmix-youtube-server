import { Router } from 'express';
import { getAdminAuth, getAdminFirestore } from '../services/adminFirebase.js';
import { getAllowedOrigins, normalizeAllowedOrigins, saveAllowedOrigins } from '../services/originSettings.js';

const router = Router();

const requireAdmin = async (req, res, next) => {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in as an administrator to manage API domains.' });

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    const userSnapshot = await getAdminFirestore().collection('users').doc(decoded.uid).get();
    if (userSnapshot.data()?.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' });
    }
    return next();
  } catch (error) {
    console.error('[Admin settings] Authentication failed:', error.message);
    if (error.message === 'Firebase Admin credentials are not configured') {
      return res.status(503).json({ error: 'Add FIREBASE_SERVICE_ACCOUNT_JSON to the Render environment to enable admin domain settings.' });
    }
    return res.status(401).json({ error: 'Could not verify your administrator session.' });
  }
};

router.get('/api/admin/allowed-origins', requireAdmin, async (_req, res) => {
  try {
    return res.json({ allowedOrigins: getAllowedOrigins() });
  } catch (error) {
    console.error('[Admin settings] Could not read allowed origins:', error.message);
    return res.status(500).json({ error: 'Could not load allowed website domains.' });
  }
});

router.put('/api/admin/allowed-origins', requireAdmin, async (req, res) => {
  try {
    const origins = normalizeAllowedOrigins(req.body?.allowedOrigins);
    const savedOrigins = await saveAllowedOrigins(origins);
    return res.json({ allowedOrigins: savedOrigins });
  } catch (error) {
    console.error('[Admin settings] Could not save allowed origins:', error.message);
    return res.status(400).json({ error: error.message || 'Could not save allowed website domains.' });
  }
});

export default router;