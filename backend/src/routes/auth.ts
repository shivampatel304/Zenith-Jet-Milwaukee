import { Router, Request, Response } from 'express';
import { authRateLimiter } from '../middleware/auth';

const router = Router();

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

router.post('/verify', authRateLimiter, (req: Request, res: Response): void => {
  const { pin } = req.body as { pin?: string };
  const validPin = process.env.APP_PIN;

  if (!validPin) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  if (pin !== validPin) {
    res.status(401).json({ error: 'Invalid PIN' });
    return;
  }

  // Store PIN as cookie value — middleware validates against env var
  res.cookie('mkw_session', pin, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: SEVEN_DAYS_MS,
  });

  res.json({ ok: true });
});

export default router;
