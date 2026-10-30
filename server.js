// Hello Bro revival server. Node 22+ (built-in node:sqlite), no dependencies.
// Protocol (reverse-engineered from libgame.so): HTTP GET/POST to /<cgi>?Cmd=..&Uin=..&Session=..
// Responses are XML: <RENLONG code="0">...</RENLONG>, values are child-element text.
const http = require('http');
const net = require('net');
const url = require('url');
const { DatabaseSync } = require('node:sqlite');
const handlers = require('./handlers');
const admin = require('./admin');

const PORT = process.env.PORT || 18080;
// Safety copy of the save on every start (keeps the last 10) in backups/.
try {
  const fs = require('fs'), path = require('path');
  const src = process.env.DB || 'hellobro.db';
  if (fs.existsSync(src)) {
    fs.mkdirSync('backups', { recursive: true });
    fs.copyFileSync(src, path.join('backups', 'hellobro-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db'));
    const old = fs.readdirSync('backups').filter((f) => f.endsWith('.db')).sort().slice(0, -10);
    for (const f of old) fs.rmSync(path.join('backups', f), { force: true });
  }
} catch (e) { console.error('backup failed', e.message); }
const db = new DatabaseSync(process.env.DB || 'hellobro.db');
require('./schema')(db);

function parseBody(req) {
  return new Promise((res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 65536) chunks.push(c); }); // cap bodies at 64 KB
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
  });
}

// Simple flood guard: at most RATE_LIMIT requests per IP per 10 seconds (the game sends a few per screen).
const RATE = Number(process.env.RATE_LIMIT || 300);
const hits = new Map();
setInterval(() => hits.clear(), 10000).unref();
function limited(req) {
  const ip = req.socket.remoteAddress || '?';
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > RATE;
}

// Errors also go to logs/error.log so problems on a public server can be read later.
function logError(...a) {
  console.error(...a);
  try {
    require('fs').mkdirSync('logs', { recursive: true });
    require('fs').appendFileSync('logs/error.log', new Date().toISOString() + ' ' + a.map((x) => (x && x.stack) || String(x)).join(' ') + String.fromCharCode(10));
  } catch {}
}

const httpServer = http.createServer({ insecureHTTPParser: true }, async (req, resp) => {
  if (limited(req)) { resp.writeHead(429); return resp.end('slow down'); }
  const u = url.parse(req.url, true);
  if (u.pathname.startsWith('/admin')) {
    try { return await admin(req, resp, u, db, parseBody); } catch (e) { logError('admin error', e); resp.writeHead(500); return resp.end('error'); }
  }
  const body = req.method === 'POST' ? await parseBody(req) : '';
  const params = { ...u.query, ...Object.fromEntries(new URLSearchParams(body)) };
  const cgi = u.pathname.replace(/^\/+/, '');
  const h = handlers[cgi];
  let out;
  try {
    out = h ? h({ db, params, cgi, host: req.headers.host }) : null;
  } catch (e) {
    logError('handler error', cgi, e);
    out = null;
  }
  if (out == null) {
    console.log(`[UNHANDLED] ${req.method} ${req.url} ${body}`);
    out = '<root code="1"><message>not implemented</message></root>';
  } else {
    console.log(`[ok] ${cgi} Cmd=${params.Cmd || ''}`);
  }
  resp.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
  // The Lua side looks for a <RENLONG> root; the C++ side accepts any root name.
  out = out.replace(/^<root/, '<RENLONG').replace(/<\/root>$/, '</RENLONG>');
  resp.end('<?xml version="1.0" encoding="UTF-8"?>' + out);
});

// The game's Lua code puts raw spaces in request URLs ("Clinettime=2026/10/29 05:42:45 Thursday"),
// which Node's strict parser rejects. Percent-encode them in the request line before parsing.
net.createServer((sock) => {
  sock.once('data', (chunk) => {
    const eol = chunk.indexOf('\r\n');
    if (eol > 0) {
      const line = chunk.subarray(0, eol).toString('latin1');
      const a = line.indexOf(' ');
      const b = line.lastIndexOf(' ');
      if (a > 0 && b > a) {
        const fixed = line.slice(0, a + 1) + line.slice(a + 1, b).replace(/ /g, '%20') + line.slice(b);
        chunk = Buffer.concat([Buffer.from(fixed, 'latin1'), chunk.subarray(eol)]);
      }
    }
    sock.unshift(chunk);
    httpServer.emit('connection', sock);
    sock.on('error', () => {});
  });
}).on('error', (e) => console.error('listen error', e.message)).listen(PORT, '0.0.0.0', () => console.log(`Hello Bro server on :${PORT}`));
