const { jsonResponse } = require('./_shared.cjs');
const {
  createCode,
  createVerificationToken,
  hasSmsConfiguration,
  normalizePhone,
  parseRequestBody,
  sendVerificationSms,
  OTP_EXPIRY_SECONDS
} = require('./_sms.cjs');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  let body;
  try {
    body = parseRequestBody(event);
  } catch {
    return jsonResponse(400, { error: 'invalid_request' });
  }

  const phone = normalizePhone(body?.phone);
  if (!phone) return jsonResponse(400, { error: 'invalid_phone' });
  if (!hasSmsConfiguration()) {
    return jsonResponse(503, { error: 'sms_not_configured' });
  }

  const code = createCode();
  const verificationToken = createVerificationToken(phone, code);
  try {
    await sendVerificationSms(phone, code, body?.language);
    return jsonResponse(200, { verificationToken, expiresIn: OTP_EXPIRY_SECONDS });
  } catch (error) {
    console.error('SMS sending failed:', error.code || 'network_error');
    return jsonResponse(502, { error: 'sms_send_failed' });
  }
};
