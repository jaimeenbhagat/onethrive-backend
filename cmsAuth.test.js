const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_SESSION_SECRET = 'local-test-secret';
const { createSession, setSessionCookie, clearSessionCookie } = require('./cmsAuth');

test('creates a signed admin session token', () => {
  const token = createSession();
  assert.equal(token.split('.').length, 2);
  assert.ok(token.length > 30);
});

test('session creation requires a configured secret', () => {
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  assert.throws(() => createSession(), /must be configured/);
  process.env.ADMIN_SESSION_SECRET = previousSecret;
});

test('production session cookie supports cross-site frontend requests', () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const headers = {};
  setSessionCookie({ setHeader: (name, value) => { headers[name] = value; } }, 'signed-token');
  assert.match(headers['Set-Cookie'], /^onethrive_admin_session=signed-token;/);
  assert.match(headers['Set-Cookie'], /HttpOnly/);
  assert.match(headers['Set-Cookie'], /SameSite=None/);
  assert.match(headers['Set-Cookie'], /Secure/);
  process.env.NODE_ENV = previousEnvironment;
});

test('production logout expires the same cross-site cookie', () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const headers = {};
  clearSessionCookie({ setHeader: (name, value) => { headers[name] = value; } });
  assert.match(headers['Set-Cookie'], /^onethrive_admin_session=;/);
  assert.match(headers['Set-Cookie'], /Max-Age=0/);
  assert.match(headers['Set-Cookie'], /SameSite=None/);
  assert.match(headers['Set-Cookie'], /Secure/);
  process.env.NODE_ENV = previousEnvironment;
});