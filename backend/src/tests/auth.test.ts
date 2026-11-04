import request from 'supertest';
import app from '../index';

// Helper to make authenticated requests
const PIN = '123456';

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    process.env.APP_PIN = PIN;
  });

  it('returns 200 and sets cookie for correct PIN', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .send({ pin: PIN });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    expect(cookies.some((c: string) => c.includes('mkw_session'))).toBe(true);
  });

  it('returns 401 for wrong PIN', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .send({ pin: '000000' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid PIN' });
  });

  it('blocks unauthenticated requests to /api/buildings', async () => {
    const res = await request(app).get('/api/buildings');
    expect(res.status).toBe(401);
  });

  it('allows authenticated requests with valid cookie', async () => {
    // First get a valid session cookie
    const loginRes = await request(app)
      .post('/api/auth/verify')
      .send({ pin: PIN });

    const cookies = (loginRes.headers['set-cookie'] as unknown as string[]).join('; ');

    // Then use it on a protected route (buildings won't load without DB, just check not 401)
    const res = await request(app)
      .get('/api/buildings')
      .set('Cookie', cookies);

    // Should not be 401 (might be 500 without DB, but auth passed)
    expect(res.status).not.toBe(401);
  });
});

describe('Rate limiting on /api/auth/verify', () => {
  it('returns 429 after 5 failed attempts from same IP', async () => {
    process.env.APP_PIN = '999999';

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/verify')
        .send({ pin: '000000' });
    }

    const res = await request(app)
      .post('/api/auth/verify')
      .send({ pin: '000000' });

    expect(res.status).toBe(429);
  });
});
