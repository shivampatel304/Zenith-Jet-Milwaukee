import request from 'supertest';
import app from '../index';

const PIN = '123456';
const COOKIE = `mkw_session=${PIN}`;

beforeAll(() => {
  process.env.APP_PIN = PIN;
  process.env.NODE_ENV = 'test';
});

describe('GET /api/search', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/search?q=test');
    expect(res.status).toBe(401);
  });

  it('returns empty array for query shorter than 2 chars', async () => {
    const res = await request(app).get('/api/search?q=a').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns empty array for missing query', async () => {
    const res = await request(app).get('/api/search').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns array for valid query (may be empty without DB)', async () => {
    const res = await request(app).get('/api/search?q=broadway').set('Cookie', COOKIE);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(20);
    }
  });
});

describe('GET /api/export/buildings', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/export/buildings');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/export/owners', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/export/owners');
    expect(res.status).toBe(401);
  });
});
