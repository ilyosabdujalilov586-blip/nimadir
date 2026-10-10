const { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { getStore } = require('@netlify/blobs');

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'ilyos_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getStoreForSite(name) {
  const options = { consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN) {
    options.siteID = process.env.NETLIFY_SITE_ID;
    options.token = process.env.NETLIFY_AUTH_TOKEN;
  }
  return getStore(name, options);
}

function getAccounts() {
  return getStoreForSite('ilyos-accounts');
}

function getAccount(email) {
  return getAccounts().get(accountKey(email), { type: 'json' });
}

function getChats() {
  return getStoreForSite('ilyos-chats');
}

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    const error = new Error('AUTH_SESSION_SECRET must contain at least 32 bytes.');
    error.code = 'auth_not_configured';
    throw error;
  }
  return secret;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function accountKey(email) {
  return `users/${createHash('sha256').update(email).digest('hex')}`;
}

function chatKey(email) {
  return `accounts/${createHash('sha256').update(email).digest('hex')}`;
}

function toPublicUser(user) {
  return { name: user.name, email: user.email };
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derivedKey = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: derivedKey.toString('hex') };
}

async function verifyPassword(password, user) {
  if (typeof user.passwordSalt !== 'string' || typeof user.passwordHash !== 'string') return false;
  const { hash } = await hashPassword(password, user.passwordSalt);
  const expected = Buffer.from(user.passwordHash, 'hex');
  const received = Buffer.from(hash, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function signSession(email, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    email,
    expiresAt: Math.floor(now / 1000) + SESSION_MAX_AGE
  })).toString('base64url');
  const signature = createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(event, now = Date.now()) {
  const cookieHeader = event.headers?.cookie || event.headers?.Cookie || '';
  const token = cookieHeader.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token || token.length > 2048) return null;

  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  let session;
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const email = normalizeEmail(session?.email);
  if (!email || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Math.floor(now / 1000)) return null;

  let expected;
  try {
    expected = createHmac('sha256', getSessionSecret()).update(payload).digest();
  } catch (error) {
    if (error.code === 'auth_not_configured') throw error;
    return null;
  }
  const received = Buffer.from(signature, 'base64url');
  return received.length === expected.length && timingSafeEqual(expected, received) ? { email } : null;
}

function sessionCookie(event, token) {
  const forwardedProtocol = event.headers?.['x-forwarded-proto'] || '';
  const secure = forwardedProtocol.split(',')[0].trim() === 'https';
  const value = token || '';
  const maxAge = token ? SESSION_MAX_AGE : 0;
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function parseBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > 1_048_576) throw new Error('Request body is too large.');
  return JSON.parse(rawBody);
}

async function createAccount({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedEmail || !normalizedName || normalizedName.length > 100 ||
      typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 1024) {
    return { error: 'invalid_account' };
  }

  const { salt, hash } = await hashPassword(password);
  const user = { email: normalizedEmail, name: normalizedName, passwordSalt: salt, passwordHash: hash };
  const result = await getAccounts().setJSON(accountKey(normalizedEmail), user, { onlyIfNew: true });
  return result.modified ? { user: toPublicUser(user) } : { error: 'email_exists' };
}

async function migrateLegacyAccount({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof password !== 'string' ||
      password.length < 1 || Buffer.byteLength(password, 'utf8') > 1024) {
    return { error: 'invalid_credentials' };
  }

  const accounts = getAccounts();
  const key = accountKey(normalizedEmail);
  const existing = await accounts.get(key, { type: 'json' });
  if (existing) {
    return await verifyPassword(password, existing)
      ? { user: toPublicUser(existing) }
      : { error: 'invalid_credentials' };
  }

  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || normalizedName.length > 100) return { error: 'invalid_account' };
  const { salt, hash } = await hashPassword(password);
  const user = { email: normalizedEmail, name: normalizedName, passwordSalt: salt, passwordHash: hash };
  const result = await accounts.setJSON(key, user, { onlyIfNew: true });
  if (result.modified) return { user: toPublicUser(user) };

  const racedAccount = await accounts.get(key, { type: 'json' });
  return racedAccount && await verifyPassword(password, racedAccount)
    ? { user: toPublicUser(racedAccount) }
    : { error: 'invalid_credentials' };
}

async function authenticateWithGoogle({ idToken, accessToken }) {
  let response;
  if (typeof idToken === 'string' && idToken.length <= 8192) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return { error: 'google_not_configured' };
    const url = new URL('https://oauth2.googleapis.com/tokeninfo');
    url.searchParams.set('id_token', idToken);
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } else if (typeof accessToken === 'string' && accessToken.length <= 8192) {
    response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000)
    });
  } else {
    return { error: 'invalid_google_credential' };
  }

  if (!response.ok) return { error: 'invalid_google_credential' };
  const profile = await response.json();
  const email = normalizeEmail(profile.email);
  if (!email || profile.email_verified !== true && profile.email_verified !== 'true' ||
      typeof profile.name !== 'string' || !profile.name.trim()) {
    return { error: 'invalid_google_credential' };
  }
  if (typeof idToken === 'string' && profile.aud !== process.env.GOOGLE_CLIENT_ID) {
    return { error: 'invalid_google_credential' };
  }

  const accounts = getAccounts();
  const key = accountKey(email);
  let user = await accounts.get(key, { type: 'json' });
  if (!user) {
    user = { email, name: profile.name.trim().slice(0, 100), authProvider: 'google' };
    const result = await accounts.setJSON(key, user, { onlyIfNew: true });
    if (!result.modified) user = await accounts.get(key, { type: 'json' });
  }
  if (!user) return { error: 'account_storage_failed' };
  return { user: toPublicUser(user) };
}

async function login({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) {
    return { error: 'invalid_credentials' };
  }
  const user = await getAccounts().get(accountKey(normalizedEmail), { type: 'json' });
  if (!user) return { error: 'account_not_found' };
  if (!await verifyPassword(password, user)) return { error: 'invalid_credentials' };
  return { user: toPublicUser(user) };
}

function validateChats(chats) {
  return Array.isArray(chats) && chats.length <= 30 && chats.every(chat =>
    chat && typeof chat.id === 'string' && chat.id.length <= 100 &&
    Number.isFinite(chat.updatedAt) && (
      Number.isFinite(chat.deletedAt) ||
      (typeof chat.title === 'string' && chat.title.length <= 200 &&
        Array.isArray(chat.messages) && chat.messages.length <= 28 &&
        chat.messages.every(message =>
          message && ['user', 'model'].includes(message.role) &&
          typeof message.text === 'string' && message.text.length <= 30_000
        ))
    )
  );
}

module.exports = {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  accountKey,
  authenticateWithGoogle,
  chatKey,
  createAccount,
  getAccount,
  getAccounts,
  getChats,
  login,
  migrateLegacyAccount,
  normalizeEmail,
  parseBody,
  readSession,
  sessionCookie,
  signSession,
  toPublicUser,
  validateChats
};
