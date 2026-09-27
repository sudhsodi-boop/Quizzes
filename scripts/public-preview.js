// Temporary public-preview gateway. Keep first-host registration inside the
// access-protected workspace preview; never expose /api/setup through the tunnel.
// The application remains responsible for authentication and authorization.
const http = require('node:http');
const UPSTREAM = Number(process.env.APP_PORT || 4173);
const PORT = Number(process.env.PUBLIC_PREVIEW_PORT || 4174);
function headers(req) {
  const result = { ...req.headers };
  result['x-forwarded-proto'] = 'https';
  result['x-forwarded-for'] = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  return result;
}
function unavailable(res) {
  if (res.headersSent) return res.end();
  res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'The testing app is temporarily unavailable.' }));
}
const gateway = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/setup') {
    res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Create the first host account in the private Arena preview, then sign in here.' }));
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: UPSTREAM, method: req.method, path: req.url, headers: headers(req) }, response => {
    if (pathname === '/api/session' && req.method === 'GET' && response.statusCode === 200) {
      let content = '';
      response.setEncoding('utf8');
      response.on('data', chunk => content += chunk);
      response.on('end', () => {
        try {
          const session = JSON.parse(content);
          session.setupEnabled = false;
          session.privateSetupRequired = session.setupRequired;
          res.writeHead(200, { ...response.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(session));
        } catch { unavailable(res); }
      });
      response.on('error', () => unavailable(res));
      return;
    }
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
    response.on('error', () => res.destroy());
  });
  upstream.on('error', () => unavailable(res));
  req.on('aborted', () => upstream.destroy());
  upstream.setTimeout(30000, () => upstream.destroy());
  req.pipe(upstream);
});
gateway.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/live') return socket.destroy();
  const upstream = http.request({ hostname: '127.0.0.1', port: UPSTREAM, method: 'GET', path: req.url, headers: headers(req) });
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('close', () => upstreamSocket.destroy());
    upstreamSocket.on('close', () => socket.destroy());
  });
  upstream.on('response', response => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`);
    response.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  upstream.end();
});
gateway.listen(PORT, '127.0.0.1', () => console.log(`Public-preview gateway listening on 127.0.0.1:${PORT}; first-host setup is blocked.`));
process.on('SIGTERM', () => gateway.close(() => process.exit(0)));
