import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRouter from './routes/auth';
import buildingsRouter from './routes/buildings';
import ownersRouter from './routes/owners';
import searchRouter from './routes/search';
import exportRouter from './routes/export';
import { requireAuth } from './middleware/auth';

const app = express();

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Public routes
app.use('/api/auth', authRouter);

// Health check (unauthenticated)
app.get('/health', (_req, res) => res.json({ ok: true }));

// Protected routes — requireAuth validates the session cookie on all /api/* routes
// Building contacts are sub-routes of /api/buildings/:id/contact
// Owner company contact is a sub-route of /api/owners/:id/company
app.use('/api/buildings', requireAuth, buildingsRouter);
app.use('/api/owners', requireAuth, ownersRouter);
app.use('/api/search', requireAuth, searchRouter);
app.use('/api/export', requireAuth, exportRouter);

// Start server in production (not during tests)
if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Milwaukee backend running on port ${PORT}`);
  });
}

export default app;
