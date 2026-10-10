const { jsonResponse } = require('./_shared.cjs');
const {
  authenticateWithGoogle,
  createAccount,
  connectBlobs,
  getAccount,
  login,
  migrateLegacyAccount,
  normalizeEmail,
  parseBody,
  readSession,
  sessionCookie,
  signSession,
  toPublicUser
} = require('./_account-store.cjs');

function responseForError(error) {
  const statuses = {
    auth_not_configured: 503,
    account_storage_failed: 503,
    account_request_failed: 500,
    account_not_found: 404,
    email_exists: 409,
    invalid_account: 400,
    invalid_credentials: 401,
    invalid_google_credential: 401,
    google_not_configured: 503
  };
  return jsonResponse(statuses[error] || 500, { error: error || 'account_request_failed' });
}

async function accountResponse(event, user) {
  const session = await signSession(user.email);
  return jsonResponse(200, { user }, {
    'Cache-Control': 'no-store',
    'Set-Cookie': sessionCookie(event, session)
  });
}

exports.handler = async event => {
  const method = event.httpMethod;
  if (!['GET', 'POST'].includes(method)) {
    return jsonResponse(405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  }

  let body = {};
  if (method === 'POST') {
    try {
      body = parseBody(event);
    } catch {
      return jsonResponse(400, { error: 'invalid_request' });
    }
  }

  try {
    connectBlobs(event);
    if (method === 'GET' || body.action === 'session') {
      const session = await readSession(event);
      if (!session) return jsonResponse(401, { error: 'not_authenticated' }, { 'Cache-Control': 'no-store' });
      const user = await getAccount(session.email);
      if (!user) return jsonResponse(401, { error: 'not_authenticated' }, { 'Cache-Control': 'no-store' });
      return jsonResponse(200, { user: toPublicUser(user) }, { 'Cache-Control': 'no-store' });
    }

    if (body.action === 'logout') {
      return jsonResponse(200, { success: true }, {
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookie(event, '')
      });
    }

    let result;
    if (body.action === 'register') {
      result = await createAccount(body);
    } else if (body.action === 'login') {
      result = await login(body);
    } else if (body.action === 'migrate') {
      result = await migrateLegacyAccount(body);
    } else if (body.action === 'google') {
      result = await authenticateWithGoogle(body);
    } else {
      return jsonResponse(400, { error: 'invalid_action' });
    }

    if (result.error) return responseForError(result.error);
    if (!normalizeEmail(result.user?.email)) return jsonResponse(500, { error: 'account_request_failed' });
    return await accountResponse(event, result.user);
  } catch (error) {
    const code = error.code === 'auth_not_configured' ? error.code : 'account_request_failed';
    console.error('Account request failed:', code);
    return responseForError(code);
  }
};
