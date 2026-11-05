// Access-code gate for the Milwaukee Covered Buildings dashboard (edge middleware, Node.js runtime).
//
// Runs before every request, including the page, the scripts and both data files, so nothing loads without
// a valid session. Configuration comes from the project's environment variables:
//   ACCESS_CODE     the code people type (set as an environment variable)
//   SESSION_SECRET  a long random string used to sign the session cookies
//   EXPORT_CODE     a second code that unlocks the CSV exports for 8 hours (exports stay locked if it is missing)
// If ACCESS_CODE or SESSION_SECRET is missing, the site refuses every request (fail closed).
//
// Locally (python3 -m http.server) this file is not used; it only runs on the host.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const config = { runtime: 'nodejs' };

const COOKIE = 'mkw_session';
const SESSION_DAYS = 7;
const LOGIN_PATH = '/__access';
const LOGOUT_PATH = '/__logout';
const EXPORT_COOKIE = 'mkw_export';
const EXPORT_HOURS = 8;
const EXPORT_UNLOCK = '/__export-unlock';
const EXPORT_STATUS = '/__export-status';
const EXPORT_LOCK = '/__export-lock';
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const FAIL_DELAY_MS = 900;
// Files that belong to the deployment but are never served.
const HIDDEN = new Set(['/middleware.js', '/package.json', '/vercel.json', '/README.md', '/DATA_FORMAT.md']);

const failures = new Map(); // per-instance throttle: ip -> { count, first, lockedUntil }

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest();
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const continueRequest = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

function settings() {
  const code = (process.env.ACCESS_CODE || '').trim();
  const secret = process.env.SESSION_SECRET || '';
  return code && secret.length >= 16 ? { code, secret } : null;
}

function sign(exp, { code, secret }) {
  // The code is part of the signature, so changing ACCESS_CODE signs everyone out.
  return b64url(createHmac('sha256', secret).update(`${exp}.${b64url(sha256(code))}`).digest());
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function validSession(request, cfg) {
  const token = readCookie(request, COOKIE);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || +exp < Date.now()) return false;
  const expected = Buffer.from(sign(exp, cfg));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function exportCode() {
  return (process.env.EXPORT_CODE || '').trim();
}

function signExport(exp, code, secret) {
  // Separate purpose prefix, so a session signature can never pass as an export unlock (and vice versa).
  return b64url(createHmac('sha256', secret).update(`export.${exp}.${b64url(sha256(code))}`).digest());
}

function validExport(request, cfg) {
  const code = exportCode();
  const token = readCookie(request, EXPORT_COOKIE);
  if (!code || !token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || +exp < Date.now()) return false;
  const expected = Buffer.from(signExport(exp, code, cfg.secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'content-type': 'application/json', ...headers } });

async function readCode(request) {
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) return String((await request.json()).code || '');
    return String((await request.formData()).get('code') || '');
  } catch {
    return '';
  }
}

function codeMatches(input, code) {
  return timingSafeEqual(sha256(String(input).replace(/\s+/g, '')), sha256(code));
}

function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

function lockedFor(ip) {
  const f = failures.get(ip);
  if (!f || !f.lockedUntil) return 0;
  const left = f.lockedUntil - Date.now();
  if (left <= 0) { failures.delete(ip); return 0; }
  return left;
}

function recordFailure(ip) {
  const now = Date.now();
  const f = failures.get(ip);
  const fresh = !f || now - f.first > LOCK_MINUTES * 60000;
  const next = fresh ? { count: 1, first: now, lockedUntil: 0 } : { ...f, count: f.count + 1 };
  if (next.count >= MAX_FAILS) next.lockedUntil = now + LOCK_MINUTES * 60000;
  failures.set(ip, next);
  if (failures.size > 5000) for (const [k, v] of failures) if (now - v.first > LOCK_MINUTES * 60000) failures.delete(k);
}

function safeNext(value) {
  const v = String(value || '/');
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && !v.startsWith(LOGIN_PATH) ? v : '/';
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
};

function loginPage({ next = '/', error = '', status = 401 } = {}) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Milwaukee Covered Buildings · Access</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23111827'/%3E%3Cpath d='M9 10h14L10 22h13' fill='none' stroke='%23fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: grid; place-items: center; padding: 16px;
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif; color: #111827;
    background: radial-gradient(120% 90% at 50% 15%, #FFFFFF 0%, #F3F5F8 60%, #E9EEF3 100%);
  }
  .card {
    width: 100%; max-width: 360px; padding: 28px 26px 22px; border-radius: 16px;
    background: rgba(255,255,255,0.88); border: 1px solid #E5E7EB;
    box-shadow: 0 2px 6px rgba(16,24,40,.05), 0 22px 50px rgba(16,24,40,.10);
  }
  .mark { width: 40px; height: 40px; border-radius: 11px; background: #111827; display: grid; place-items: center; margin-bottom: 16px; }
  .mark svg { width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
  h1 { margin: 0; font-size: 18px; font-weight: 680; letter-spacing: -0.01em; }
  p { margin: 4px 0 18px; color: #6B7280; }
  label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 6px; }
  input {
    width: 100%; height: 46px; padding: 0 14px; border-radius: 11px; border: 1px solid #D1D5DB; background: #fff;
    font: 600 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.3em; text-align: center; color: #111827; outline: none;
  }
  input:focus { border-color: #9CA3AF; box-shadow: 0 0 0 4px rgba(17,24,39,0.07); }
  button {
    width: 100%; height: 44px; margin-top: 12px; border: 0; border-radius: 11px; background: #111827; color: #fff;
    font: 600 14px/1 inherit; cursor: pointer; box-shadow: 0 2px 6px rgba(17,24,39,.18);
  }
  button:hover { background: #1F2937; }
  .error { margin: 12px 0 0; padding: 9px 11px; border-radius: 10px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; font-size: 13px; font-weight: 550; }
  .foot { margin-top: 18px; font-size: 11.5px; color: #9CA3AF; text-align: center; }
</style></head>
<body>
  <form class="card" method="post" action="${LOGIN_PATH}" autocomplete="off">
    <div class="mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M9 10h14L10 22h13"/></svg></div>
    <h1>Milwaukee Covered Buildings</h1>
    <p>Azzera · internal dashboard</p>
    <label for="code">Access code</label>
    <input id="code" name="code" type="password" inputmode="numeric" autocomplete="off" autofocus required>
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <button type="submit">Open dashboard</button>
    ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="foot">Internal only. Do not share this link or the code outside the team.</div>
  </form>
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      ...BASE_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function exportCookie(value, maxAge) {
  return `${EXPORT_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { ...BASE_HEADERS, 'content-type': 'text/plain' } });
  }

  const cfg = settings();
  if (!cfg) {
    return new Response('Access is not configured for this deployment.', { status: 503, headers: { ...BASE_HEADERS, 'content-type': 'text/plain' } });
  }

  if (path === LOGOUT_PATH) {
    const headers = new Headers({ ...BASE_HEADERS, location: '/' });
    headers.append('set-cookie', sessionCookie('', 0));
    headers.append('set-cookie', exportCookie('', 0));
    return new Response(null, { status: 303, headers });
  }

  if (path === LOGIN_PATH) {
    if (request.method !== 'POST') return Response.redirect(new URL('/', url), 303);
    const ip = clientIp(request);
    let form;
    try { form = await request.formData(); } catch { form = new FormData(); }
    const next = safeNext(form.get('next'));
    const locked = lockedFor(ip);
    if (locked) {
      return loginPage({ next, status: 429, error: `Too many attempts. Try again in ${Math.ceil(locked / 60000)} minutes.` });
    }
    if (!codeMatches(form.get('code') || '', cfg.code)) {
      recordFailure(ip);
      console.warn(`[access] wrong code from ${ip}`);
      await sleep(FAIL_DELAY_MS);
      return loginPage({ next, error: 'That code is not right. Try again.' });
    }
    failures.delete(ip);
    const exp = Date.now() + SESSION_DAYS * 86400000;
    return new Response(null, {
      status: 303,
      headers: { ...BASE_HEADERS, location: next, 'set-cookie': sessionCookie(`${exp}.${sign(exp, cfg)}`, SESSION_DAYS * 86400) },
    });
  }

  if (!validSession(request, cfg)) {
    const wantsPage = request.method === 'GET' && (path === '/' || path.endsWith('.html') || (request.headers.get('accept') || '').includes('text/html'));
    if (wantsPage) return loginPage({ next: safeNext(path + url.search) });
    return new Response('Access code required.', { status: 401, headers: { ...BASE_HEADERS, 'content-type': 'text/plain' } });
  }

  // ---- CSV export lock (only reachable with a valid session) ----
  if (path === EXPORT_STATUS) {
    return json({ unlocked: validExport(request, cfg), configured: !!exportCode() });
  }
  if (path === EXPORT_LOCK) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    return json({ unlocked: false }, 200, { 'set-cookie': exportCookie('', 0) });
  }
  if (path === EXPORT_UNLOCK) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    const code = exportCode();
    if (!code) return json({ error: 'Exports are not configured on this deployment.' }, 503);
    const key = `export:${clientIp(request)}`;
    const locked = lockedFor(key);
    if (locked) return json({ error: `Too many attempts. Try again in ${Math.ceil(locked / 60000)} minutes.` }, 429);
    if (!codeMatches(await readCode(request), code)) {
      recordFailure(key);
      console.warn(`[export] wrong export code from ${clientIp(request)}`);
      await sleep(FAIL_DELAY_MS);
      return json({ error: 'That export code is not right.' }, 401);
    }
    failures.delete(key);
    const exp = Date.now() + EXPORT_HOURS * 3600000;
    return json({ unlocked: true, expiresAt: exp }, 200, { 'set-cookie': exportCookie(`${exp}.${signExport(exp, code, cfg.secret)}`, EXPORT_HOURS * 3600) });
  }

  if (HIDDEN.has(path)) return new Response('Not found', { status: 404, headers: BASE_HEADERS });
  return continueRequest();
}
