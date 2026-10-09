const { jsonResponse } = require('./_shared.cjs');
const { normalizePhone, parseRequestBody, verifyCodeToken } = require('./_sms.cjs');

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
  if (!phone || typeof body?.verificationToken !== 'string' ||
      typeof body?.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    return jsonResponse(400, { error: 'invalid_request' });
  }
  if (!verifyCodeToken(body.verificationToken, phone, body.code)) {
    return jsonResponse(401, { error: 'invalid_code' });
  }

  return jsonResponse(200, { verified: true });
};
