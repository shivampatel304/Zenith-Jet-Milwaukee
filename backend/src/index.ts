import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRouter from './routes/auth';
import { requireAuth } from './middleware/auth';

const app = express();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Public routes
app.use('/api/auth', authRouter);

// Protected routes — all /api/* except /api/auth require a valid session cookie
// Routes are mounted here; additional routers added in Tasks 5–8
app.use('/api/*', requireAuth);

// Health check (unauthenticated)
app.get('/health', (_req, res) => res.json({ ok: true }));

// Start server in production (not during tests)
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Milwaukee backend running on port ${PORT}`);
  });
}

export default app;
