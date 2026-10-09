const { createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const { getLanguage } = require('./_shared.cjs');

const OTP_EXPIRY_SECONDS = 300;
const ESKIZ_API_URL = 'https://notify.eskiz.uz/api';

function normalizePhone(phone) {
  if (typeof phone !== 'string') return null;
  const normalized = phone.trim().replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function hasSmsConfiguration() {
  return Boolean(
    process.env.ESKIZ_EMAIL &&
    process.env.ESKIZ_PASSWORD &&
    process.env.ESKIZ_FROM &&
    process.env.OTP_SIGNING_SECRET &&
    Buffer.byteLength(process.env.OTP_SIGNING_SECRET, 'utf8') >= 32
  );
}

function getSigningSecret() {
  const secret = process.env.OTP_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    const error = new Error('OTP signing secret is missing or too short.');
    error.code = 'otp_not_configured';
    throw error;
  }
  return secret;
}

function createVerificationToken(phone, code, now = Date.now()) {
  const secret = getSigningSecret();
  const payload = Buffer.from(JSON.stringify({
    expiresAt: now + OTP_EXPIRY_SECONDS * 1000,
    nonce: randomBytes(16).toString('base64url')
  })).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${payload}.${phone}.${code}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyCodeToken(token, phone, code, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024 ||
      typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;

  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return false;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (!claims || typeof claims !== 'object' ||
      !Number.isSafeInteger(claims.expiresAt) || claims.expiresAt <= now ||
      claims.expiresAt > now + OTP_EXPIRY_SECONDS * 1000 ||
      typeof claims.nonce !== 'string') return false;

  let expected;
  try {
    expected = createHmac('sha256', getSigningSecret())
      .update(`${payload}.${phone}.${code}`)
      .digest();
  } catch (error) {
    if (error.code === 'otp_not_configured') return false;
    throw error;
  }

  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function createSmsText(code, language) {
  const messages = {
    uz: `ILYOS AI: Tasdiqlash kodingiz ${code}. Kod 5 daqiqa amal qiladi.`,
    en: `ILYOS AI: Your verification code is ${code}. It expires in 5 minutes.`,
    ru: `ILYOS AI: Ваш код подтверждения: ${code}. Он действует 5 минут.`
  };
  return messages[getLanguage(language)];
}

async function sendVerificationSms(phone, code, language) {
  const credentials = new URLSearchParams({
    email: process.env.ESKIZ_EMAIL,
    password: process.env.ESKIZ_PASSWORD
  });
  const authResponse = await fetch(`${ESKIZ_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: credentials,
    signal: AbortSignal.timeout(10_000)
  });
  if (!authResponse.ok) {
    const error = new Error(`Eskiz authentication failed with HTTP ${authResponse.status}.`);
    error.code = 'eskiz_auth_failed';
    throw error;
  }

  const authResult = await authResponse.json();
  const accessToken = authResult?.data?.token;
  if (typeof accessToken !== 'string' || !accessToken) {
    const error = new Error('Eskiz authentication response did not contain a token.');
    error.code = 'eskiz_auth_failed';
    throw error;
  }

  const message = new URLSearchParams({
    mobile_phone: phone.slice(1),
    message: createSmsText(code, language),
    from: process.env.ESKIZ_FROM
  });
  const smsResponse = await fetch(`${ESKIZ_API_URL}/message/sms/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: message,
    signal: AbortSignal.timeout(10_000)
  });
  if (!smsResponse.ok) {
    const error = new Error(`Eskiz SMS request failed with HTTP ${smsResponse.status}.`);
    error.code = 'eskiz_send_failed';
    throw error;
  }
}

function parseRequestBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  if (Buffer.byteLength(rawBody, 'utf8') > 4096) throw new Error('Request body is too large.');
  return JSON.parse(rawBody);
}

function createCode() {
  return String(randomInt(100_000, 1_000_000));
}

module.exports = {
  OTP_EXPIRY_SECONDS,
  createCode,
  createVerificationToken,
  hasSmsConfiguration,
  normalizePhone,
  parseRequestBody,
  sendVerificationSms,
  verifyCodeToken
};
