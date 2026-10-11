exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Allow: 'GET'
      },
      body: JSON.stringify({ error: 'method_not_allowed' })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    })
  };
};
