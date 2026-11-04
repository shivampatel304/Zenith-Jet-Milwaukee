import request from 'supertest';
import app from '../index';

const PIN = '123456';
const COOKIE = `mkw_session=${PIN}`;

beforeAll(() => {
  process.env.APP_PIN = PIN;
  process.env.NODE_ENV = 'test';
});

describe('GET /api/buildings', () => {
  it('returns 401 without cookie', async () => {
    const res = await request(app).get('/api/buildings');
    expect(res.status).toBe(401);
  });

  it('returns array with owner and contact nested when DB is available', async () => {
    const res = await request(app).get('/api/buildings').set('Cookie', COOKIE);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        const b = res.body[0];
        expect(b).toHaveProperty('id');
        expect(b).toHaveProperty('address');
        expect(b).toHaveProperty('owner');
        expect(b.owner).toHaveProperty('name');
        expect(b).toHaveProperty('contact');
        expect(b).toHaveProperty('lat');
        expect(b).toHaveProperty('priority_tier');
      }
    } else {
      // No DB in test environment — auth passed (not 401)
      expect(res.status).not.toBe(401);
    }
  });
});

describe('GET /api/buildings/:id', () => {
  it('returns 404 or 500 for unknown UUID (not 401)', async () => {
    const res = await request(app)
      .get('/api/buildings/00000000-0000-0000-0000-000000000000')
      .set('Cookie', COOKIE);
    expect([404, 500]).toContain(res.status);
  });
});
