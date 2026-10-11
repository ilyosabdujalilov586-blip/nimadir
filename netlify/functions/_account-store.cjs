const { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const nodemailer = require('nodemailer');
const { getStore } = require('@netlify/blobs');

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'ilyos_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const VERIFICATION_LIFETIME = 10 * 60 * 1000;
const VERIFICATION_RESEND_DELAY = 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_STORE_ROOT = path.join(__dirname, '..', '..', '.local-store');

async function readLocalStore(name) {
  const filePath = path.join(LOCAL_STORE_ROOT, `${name}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeLocalStore(name, data) {
  await mkdir(LOCAL_STORE_ROOT, { recursive: true });
  const filePath = path.join(LOCAL_STORE_ROOT, `${name}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createLocalStore(name) {
  return {
    async get(key, options = {}) {
      const data = await readLocalStore(name);
      const value = data[key];
      if (value === undefined) return null;
      return options.type === 'json' ? value : String(value);
    },
    async set(key, value, options = {}) {
      const data = await readLocalStore(name);
      const previous = data[key];
      data[key] = value;
      await writeLocalStore(name, data);
      return { modified: previous !== value };
    },
    async setJSON(key, value, options = {}) {
      const data = await readLocalStore(name);
      if (options.onlyIfNew && Object.prototype.hasOwnProperty.call(data, key)) {
        return { modified: false };
      }
      data[key] = value;
      await writeLocalStore(name, data);
      return { modified: true };
    },
    async delete(key) {
      const data = await readLocalStore(name);
      if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
      delete data[key];
      await writeLocalStore(name, data);
      return true;
    }
  };
}

function hasNetlifyConfig() {
  const siteId = process.env.NETLIFY_SITE_ID || '';
  const token = process.env.NETLIFY_AUTH_TOKEN || '';
  const placeholderPattern = /(?:replace|your_)/i;
  return siteId.trim().length > 0 && token.trim().length > 0 &&
    !placeholderPattern.test(siteId) && !placeholderPattern.test(token);
}

function getStoreForSite(name) {
  if (!hasNetlifyConfig()) {
    return createLocalStore(name);
  }

  const options = { consistency: 'strong' };
  options.siteID = process.env.NETLIFY_SITE_ID;
  options.token = process.env.NETLIFY_AUTH_TOKEN;
  return getStore(name, options);
}

function getAccounts() {
  return getStoreForSite('ilyos-accounts');
}

function getEmailVerifications() {
  return getStoreForSite('ilyos-email-verifications');
}

function getAccount(email) {
  return getAccounts().get(accountKey(email), { type: 'json' });
}

function getChats() {
  return getStoreForSite('ilyos-chats');
}

async function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (secret) {
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      const error = new Error('AUTH_SESSION_SECRET must contain at least 32 bytes.');
      error.code = 'auth_not_configured';
      throw error;
    }
    return secret;
  }

  const accounts = getAccounts();
  const key = 'config/session-hmac-secret';
  const existingSecret = await accounts.get(key);
  if (existingSecret) return existingSecret;

  const generatedSecret = randomBytes(32).toString('base64url');
  const result = await accounts.set(key, generatedSecret, { onlyIfNew: true });
  if (result.modified) return generatedSecret;

  const createdSecret = await accounts.get(key);
  if (createdSecret) return createdSecret;
  throw new Error('Could not initialize the account session secret.');
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

async function signSession(email, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    email,
    expiresAt: Math.floor(now / 1000) + SESSION_MAX_AGE
  })).toString('base64url');
  const signature = createHmac('sha256', await getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function readSession(event, now = Date.now()) {
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

  const expected = createHmac('sha256', await getSessionSecret()).update(payload).digest();
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

function verificationKey(email) {
  return `pending/${createHash('sha256').update(email).digest('hex')}`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function canShowLocalVerificationCode() {
  return process.env.NODE_ENV !== 'production' &&
    !process.env.NETLIFY &&
    !process.env.NETLIFY_SITE_ID &&
    !process.env.NETLIFY_AUTH_TOKEN;
}

async function sendVerificationEmail(email, name, code, purpose = 'registration') {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const hasPlaceholderValue = value => typeof value === 'string' && /(?:replace|your_|xxx)/i.test(value);
  const isLogin = purpose === 'login';
  const action = isLogin ? 'hisobingizga kirishni tasdiqlash' : 'hisobingizni tasdiqlash';

  if (!gmailUser || !gmailPass || hasPlaceholderValue(gmailUser) || hasPlaceholderValue(gmailPass)) {
    console.warn('[Email] Gmail sozlanmagan. .env fayliga GMAIL_USER va GMAIL_APP_PASSWORD qo\'shing.');
    return { error: 'email_service_not_configured' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass
    }
  });

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#080b14;padding:32px;border-radius:16px;border:1px solid rgba(167,177,210,.2)">
      <h2 style="color:#c4b3ff;font-size:22px;margin:0 0 16px">Ilyos AI — ${isLogin ? 'Kirish kodi' : 'Tasdiqlash kodi'}</h2>
      <p style="color:#b6bfd3;font-size:15px">Salom, <strong style="color:#f6f7fb">${escapeHtml(name)}</strong>!</p>
      <p style="color:#b6bfd3;font-size:14px">Ilyos ${action} uchun quyidagi kodni kiriting:</p>
      <div style="background:rgba(139,107,255,.12);border:1px solid rgba(174,149,255,.25);border-radius:12px;padding:20px;text-align:center;margin:20px 0">
        <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#ffffff">${code}</span>
      </div>
      <p style="color:#77829a;font-size:12px">Kod <strong>10 daqiqa</strong> davomida amal qiladi. Agar bu siz bo'lmasangiz, kodni hech kimga bermang va xabarni e'tiborsiz qoldiring.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Ilyos AI" <${gmailUser}>`,
      to: email,
      subject: `Ilyos AI — ${isLogin ? 'Kirish kodi' : 'Tasdiqlash kodi'}`,
      text: `Salom, ${name}!\n\nIlyos ${action} kodi: ${code}\nKod 10 daqiqa davomida amal qiladi. Agar bu siz bo'lmasangiz, kodni hech kimga bermang.`,
      html: htmlBody
    });
    console.log('[Email] Tasdiqlash kodi yuborildi:', email);
    return {};
  } catch (error) {
    console.error('[Email] Yuborishda xatolik:', error.message);
    return { error: 'email_delivery_failed' };
  }
}

async function startAccountRegistration({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedEmail || !normalizedName || normalizedName.length > 100 ||
      typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 1024) {
    return { error: 'invalid_account' };
  }

  const accounts = getAccounts();
  if (await accounts.get(accountKey(normalizedEmail), { type: 'json' })) {
    return { error: 'email_exists' };
  }

  const verifications = getEmailVerifications();
  const key = verificationKey(normalizedEmail);
  const existing = await verifications.get(key, { type: 'json' });
  const now = Date.now();
  if (existing && existing.expiresAt > now && now - existing.createdAt < VERIFICATION_RESEND_DELAY) {
    return { error: 'verification_rate_limited' };
  }

  const { salt, hash } = await hashPassword(password);
  const code = String(randomInt(100_000, 1_000_000));
  const pending = {
    id: randomBytes(16).toString('hex'),
    email: normalizedEmail,
    name: normalizedName,
    passwordSalt: salt,
    passwordHash: hash,
    codeHash: createHmac('sha256', await getSessionSecret())
      .update(`${normalizedEmail}:${code}`)
      .digest('hex'),
    attempts: 0,
    createdAt: now,
    expiresAt: now + VERIFICATION_LIFETIME
  };

  await verifications.setJSON(key, pending);
  const delivery = await sendVerificationEmail(normalizedEmail, normalizedName, code);
  if (delivery.error) {
    if (canShowLocalVerificationCode()) return { pending: true, devCode: code };
    const current = await verifications.get(key, { type: 'json' });
    if (current?.id === pending.id) await verifications.delete(key);
    return delivery;
  }
  return { pending: true };
}

async function verifyAccountRegistration({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { error: 'invalid_verification_code' };
  }

  const verifications = getEmailVerifications();
  const key = verificationKey(normalizedEmail);
  const pending = await verifications.get(key, { type: 'json' });
  if (!pending) return { error: 'verification_expired' };
  if (pending.expiresAt <= Date.now()) {
    await verifications.delete(key);
    return { error: 'verification_expired' };
  }

  const codeHash = createHmac('sha256', await getSessionSecret())
    .update(`${normalizedEmail}:${code}`)
    .digest();
  const expectedHash = Buffer.from(pending.codeHash, 'hex');
  if (expectedHash.length !== codeHash.length || !timingSafeEqual(expectedHash, codeHash)) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      await verifications.delete(key);
      return { error: 'verification_attempts_exceeded' };
    }
    await verifications.setJSON(key, pending);
    return { error: 'invalid_verification_code' };
  }

  const user = {
    email: pending.email,
    name: pending.name,
    passwordSalt: pending.passwordSalt,
    passwordHash: pending.passwordHash
  };
  const result = await getAccounts().setJSON(accountKey(normalizedEmail), user, { onlyIfNew: true });
  await verifications.delete(key);
  return result.modified ? { user: toPublicUser(user) } : { error: 'email_exists' };
}

function loginVerificationKey(email) {
  return `login/${createHash('sha256').update(email).digest('hex')}`;
}

function verificationCodeHash(email, code, secret) {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

async function sendLoginVerification(email, user, previous) {
  const verifications = getEmailVerifications();
  const key = loginVerificationKey(email);
  const code = String(randomInt(100_000, 1_000_000));
  const now = Date.now();
  const pending = {
    email,
    name: typeof user.name === 'string' && user.name.trim() ? user.name.trim() : 'foydalanuvchi',
    codeHash: verificationCodeHash(email, code, await getSessionSecret()),
    attempts: 0,
    createdAt: now,
    expiresAt: now + VERIFICATION_LIFETIME
  };

  await verifications.setJSON(key, pending);
  const delivery = await sendVerificationEmail(email, pending.name, code, 'login');
  if (delivery.error) {
    if (canShowLocalVerificationCode()) return { pending: true, devCode: code };
    if (previous) await verifications.setJSON(key, previous);
    else await verifications.delete(key);
    return delivery;
  }
  return { pending: true };
}

async function startLoginVerification({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) {
    return { error: 'invalid_credentials' };
  }
  const user = await getAccounts().get(accountKey(normalizedEmail), { type: 'json' });
  if (!user) return { error: 'account_not_found' };
  if (!await verifyPassword(password, user)) return { error: 'invalid_credentials' };

  const verifications = getEmailVerifications();
  const key = loginVerificationKey(normalizedEmail);
  const existing = await verifications.get(key, { type: 'json' });
  const now = Date.now();
  if (existing && existing.expiresAt > now && now - existing.createdAt < VERIFICATION_RESEND_DELAY) {
    return { pending: true };
  }
  return sendLoginVerification(normalizedEmail, user, existing);
}

async function resendLoginVerification({ email }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { error: 'invalid_verification_code' };

  const verifications = getEmailVerifications();
  const key = loginVerificationKey(normalizedEmail);
  const existing = await verifications.get(key, { type: 'json' });
  if (!existing || existing.expiresAt <= Date.now()) {
    if (existing) await verifications.delete(key);
    return { error: 'verification_expired' };
  }
  if (Date.now() - existing.createdAt < VERIFICATION_RESEND_DELAY) {
    return { error: 'verification_rate_limited' };
  }

  const user = await getAccounts().get(accountKey(normalizedEmail), { type: 'json' });
  if (!user) {
    await verifications.delete(key);
    return { error: 'account_not_found' };
  }
  return sendLoginVerification(normalizedEmail, user, existing);
}

async function verifyLoginVerification({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return { error: 'invalid_verification_code' };
  }

  const verifications = getEmailVerifications();
  const key = loginVerificationKey(normalizedEmail);
  const pending = await verifications.get(key, { type: 'json' });
  if (!pending) return { error: 'verification_expired' };
  if (pending.expiresAt <= Date.now()) {
    await verifications.delete(key);
    return { error: 'verification_expired' };
  }

  const codeHash = Buffer.from(verificationCodeHash(normalizedEmail, code, await getSessionSecret()), 'hex');
  const expectedHash = Buffer.from(pending.codeHash, 'hex');
  if (expectedHash.length !== codeHash.length || !timingSafeEqual(expectedHash, codeHash)) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      await verifications.delete(key);
      return { error: 'verification_attempts_exceeded' };
    }
    await verifications.setJSON(key, pending);
    return { error: 'invalid_verification_code' };
  }

  const user = await getAccounts().get(accountKey(normalizedEmail), { type: 'json' });
  await verifications.delete(key);
  return user ? { user: toPublicUser(user) } : { error: 'account_not_found' };
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
  if (!email || (profile.email_verified !== true && profile.email_verified !== 'true') ||
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
  startLoginVerification,
  startAccountRegistration,
  toPublicUser,
  validateChats,
  verifyLoginVerification,
  verifyAccountRegistration,
  resendLoginVerification
};
