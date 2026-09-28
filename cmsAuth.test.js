const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_SESSION_SECRET = 'local-test-secret';
const { createSession } = require('./cmsAuth');

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