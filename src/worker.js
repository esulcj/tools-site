addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});

function handleRequest(request) {
  var url = new URL(request.url);
  var path = url.pathname;

  if (path.indexOf('/api/') === 0) {
    return handleApi(request, path);
  }

  // Everything else falls through to [assets] (static files)
  return fetch(request);
}

function handleApi(request, path) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders()
    });
  }

  if (path === '/api/health') {
    return jsonResponse({ status: 'ok' });
  }

  return jsonResponse({ error: 'not found' }, 404);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

function corsHeaders(extra) {
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (extra) {
    for (var key in extra) {
      headers[key] = extra[key];
    }
  }
  return headers;
}
