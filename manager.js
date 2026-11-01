// Server Manager: http://<server>:18080/manager  (same password rule as /admin: open unless ADMIN_PASSWORD is set).
// Live status, who is online, the live log, events on/off, the in-game announcement, backups, restart and stop.
// Restart works when the server was started with START-SERVER.bat: the server exits with code 3 and the .bat starts it again.
const fs = require('fs');
const path = require('path');
const os = require('os');
const settings = require('./settings');
const { authorized } = require('./admin');

const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const dbFile = () => path.resolve(process.env.DB || 'hellobro.db');
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'cdn', 'manifest.json'), 'utf8')).val; } catch { return '28.0'; } };

// Addresses people can use to reach this PC (Tailscale ones start with 100.).
function addresses(port) {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ ip: a.address, kind: a.address.startsWith('100.') ? 'Tailscale' : 'Home network', name, url: `http://${a.address}:${port}` });
    }
  }
  return out.sort((x, y) => (x.kind === 'Tailscale' ? -1 : 1) - (y.kind === 'Tailscale' ? -1 : 1));
}

function backups() {
  const dir = path.join(process.cwd(), 'backups');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  } catch { return []; }
}

function status(db, port) {
  const nick = db.prepare('SELECT nick, level FROM players WHERE uid=? ORDER BY level DESC LIMIT 1');
  const online = settings.online().map((o) => ({ ...o, ...(nick.get(o.uid) || { nick: 'uid ' + o.uid, level: 0 }) })).sort((a, b) => b.at - a.at);
  const one = (sql) => { try { return db.prepare(sql).get().n; } catch { return 0; } };
  let size = 0;
  try { size = fs.statSync(dbFile()).size; } catch {}
  return {
    now: Date.now(), started: settings.started, port, version: version(), node: process.version, pid: process.pid,
    memory: process.memoryUsage().rss, requests: settings.stats().requests, restartable: process.env.HB_MANAGED === '1',
    players: one('SELECT COUNT(*) n FROM players'), accounts: one('SELECT COUNT(*) n FROM accounts'), groups: one('SELECT COUNT(*) n FROM groups'),
    online, addresses: addresses(port), dbSize: size, backups: backups().slice(0, 8),
    events: settings.EVENTS.map((e) => ({ ...e, on: settings.eventOn(db, e.id) })),
    news: settings.news(db), banner: settings.banner(db),
  };
}

let pageCache = null;
module.exports = async function manager(req, res, u, db, readBody) {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Hello Bro manager"' });
    return res.end('password required');
  }
  const port = req.socket.localPort;
  if (u.pathname === '/manager' || u.pathname === '/manager/') {
    if (!pageCache || process.env.HB_DEBUG) pageCache = fs.readFileSync(path.join(__dirname, 'manager.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(pageCache);
  }
  if (u.pathname === '/manager/api/status') return json(res, status(db, port));
  if (u.pathname === '/manager/api/log') {
    const since = Number(u.query.since) || 0;
    return json(res, settings.log.filter((l) => l.t > since));
  }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('not found'); }
  let b = {};
  try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, { ok: false, error: 'bad json' }); }
  if (u.pathname === '/manager/api/event') {
    const e = settings.EVENTS.find((x) => x.id === Number(b.id));
    if (!e) return json(res, { ok: false, error: 'no such event' });
    settings.setEvent(db, e.id, !!b.on);
    console.log(`[manager] event "${e.name}" switched ${b.on ? 'ON' : 'OFF'}`);
    return json(res, { ok: true });
  }
  if (u.pathname === '/manager/api/news') {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300) || settings.DEFAULT_NEWS;
    settings.setNews(db, text);
    console.log('[manager] announcement changed');
    return json(res, { ok: true, text });
  }
  if (u.pathname === '/manager/api/banner') {
    const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300) || settings.DEFAULT_BANNER;
    settings.set(db, 'banner', text);
    console.log('[manager] top banner changed');
    return json(res, { ok: true, text });
  }
  if (u.pathname === '/manager/api/backup') {
    const dir = path.join(process.cwd(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const name = 'manual-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db';
    db.exec(`VACUUM INTO '${path.join(dir, name).replace(/'/g, "''")}'`);
    console.log('[manager] backup saved: backups/' + name);
    return json(res, { ok: true, name });
  }
  if (u.pathname === '/manager/api/restart' || u.pathname === '/manager/api/stop') {
    const restart = u.pathname.endsWith('restart');
    console.log(`[manager] ${restart ? 'restarting' : 'stopping'} the server`);
    json(res, { ok: true });
    // exit code 3 = START-SERVER.bat starts the server again; 0 = stay stopped
    setTimeout(() => process.exit(restart ? 3 : 0), 400);
    return;
  }
  res.writeHead(404); res.end('not found');
};

// The console window: a coloured banner with the addresses, then the log as before.
module.exports.banner = function banner(port, db) {
  const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
  const line = c(33, '  ' + '═'.repeat(64));
  const players = (() => { try { return db.prepare('SELECT COUNT(*) n FROM players').get().n; } catch { return 0; } })();
  const out = [
    '', line,
    c('1;33', '   ██╗  ██╗███████╗██╗     ██╗      ██████╗     ██████╗ ██████╗  ██████╗ '),
    c('1;33', '   ██║  ██║██╔════╝██║     ██║     ██╔═══██╗    ██╔══██╗██╔══██╗██╔═══██╗'),
    c('1;31', '   ███████║█████╗  ██║     ██║     ██║   ██║    ██████╔╝██████╔╝██║   ██║'),
    c('1;31', '   ██╔══██║██╔══╝  ██║     ██║     ██║   ██║    ██╔══██╗██╔══██╗██║   ██║'),
    c('1;35', '   ██║  ██║███████╗███████╗███████╗╚██████╔╝    ██████╔╝██║  ██║╚██████╔╝'),
    c('1;35', '   ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝ ╚═════╝     ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ '),
    c(90, `                     revival server ${version()}  ·  ${players} players in the save`),
    line, '',
    c('1;32', '   ● SERVER ONLINE') + c(90, `   port ${port}`), '',
    c(1, '   Server Manager  ') + c(36, `http://localhost:${port}/manager`) + c(90, '   (events, status, restart)'),
    c(1, '   Admin page      ') + c(36, `http://localhost:${port}/admin`) + c(90, '     (give items, edit players)'), '',
    ...addresses(port).map((a) => c(90, `   ${a.kind.padEnd(13)}`) + c(37, a.url)),
    '', c(90, '   Keep this window open while people play. Close it (or press Stop in the manager) to stop the server.'),
    line, '',
  ];
  process.stdout.write(out.join('\n') + '\n');
  settings.addLog('info', `Hello Bro server online on port ${port}`);
};
