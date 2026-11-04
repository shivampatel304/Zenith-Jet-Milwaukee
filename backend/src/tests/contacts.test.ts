import request from 'supertest';
import app from '../index';

const PIN = '123456';
const COOKIE = `mkw_session=${PIN}`;

beforeAll(() => {
  process.env.APP_PIN = PIN;
  process.env.NODE_ENV = 'test';
});

describe('PUT /api/buildings/:id/contact', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/buildings/fake-id/contact')
      .send({ status: 'named_contact' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app)
      .put('/api/buildings/00000000-0000-0000-0000-000000000000/contact')
      .set('Cookie', COOKIE)
      .send({ status: 'invalid_status' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  it('accepts all 5 valid status values without returning 400', async () => {
    const statuses = [
      'named_contact', 'company_only', 'not_researched',
      'no_contact_found', 'no_owner_found',
    ];
    for (const status of statuses) {
      const res = await request(app)
        .put('/api/buildings/00000000-0000-0000-0000-000000000000/contact')
        .set('Cookie', COOKIE)
        .send({ status });
      // 400 means status was rejected — any other code is acceptable in test env
      expect(res.status).not.toBe(400);
    }
  });
});

describe('PUT /api/owners/:id/company', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).put('/api/owners/fake-id/company').send({});
    expect(res.status).toBe(401);
  });
});
