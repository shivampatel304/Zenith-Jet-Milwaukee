import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

// Cookie-based PIN session middleware
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionCookie = req.cookies?.mkw_session;
  const validPin = process.env.APP_PIN;

  if (!validPin) {
    res.status(500).json({ error: 'Server misconfigured: APP_PIN not set' });
    return;
  }

  if (sessionCookie === validPin) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized' });
}
