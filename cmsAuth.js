const crypto = require('crypto');

const SESSION_COOKIE = 'onethrive_admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const isProduction = () => process.env.NODE_ENV === 'production';

const cookieAttributes = (maxAge) => [
  `${SESSION_COOKIE}=`,
  'HttpOnly',
  'Path=/',
  `Max-Age=${maxAge}`,
  `SameSite=${isProduction() ? 'None' : 'Lax'}`,
  ...(isProduction() ? ['Secure'] : []),
].join('; ');

const getSecret = () => process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const sign = (value) => crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');

const createSession = () => {
  if (!getSecret()) {
    throw new Error('ADMIN_SESSION_SECRET or ADMIN_PASSWORD must be configured');
  }

  const payload = Buffer.from(JSON.stringify({
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
};

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';').map((part) => part.trim().split('='))
    .filter(([key, value]) => key && value)
    .map(([key, ...value]) => [key, decodeURIComponent(value.join('='))])
);

const verifySession = (token) => {
  if (!token || !getSecret()) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'admin' && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
};

const requireAdmin = (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  if (!verifySession(cookies[SESSION_COOKIE])) {
    return res.status(401).json({ success: false, error: 'Admin authentication required' });
  }
  return next();
};

const setSessionCookie = (res, token) => {
  res.setHeader('Set-Cookie', cookieAttributes(SESSION_TTL_SECONDS).replace(`${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${encodeURIComponent(token)}`));
};

const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', cookieAttributes(0));
};

module.exports = {
  SESSION_COOKIE,
  createSession,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
};
