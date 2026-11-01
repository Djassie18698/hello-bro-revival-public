// Account login for the APK's built-in account window (the old Gumptech SDK: "Play" as a guest, "Login with Gumptech", register).
// Revival APKs (classes.dex patched: com.gumptech.sdk.c.a.b reads its base address from assets/baseconfig.json) send these to this server:
//  POST /quick/reg.do   deviceId, appId, appkey          -> a new guest for this phone; its secret password is kept on the phone
//  POST /quick/login.do deviceId, appId, passwd          -> the guest of this phone (the phone sends its kept password back)
//  POST /gump/reg.do    deviceId, appId, appkey, email, passwd -> a named account (name + password); from a phone that has a guest,
//                                                           that guest's game account gets the name, so it can be used on another phone
//  POST /gump/login.do  deviceId, appId, email, passwd   -> a named account
// Answer (JSON, what com.gumptech.sdk.d.a reads): { code: 100000, nick, passwd, userId, sessionKey, ... }; 100010 wrong password,
// 100011 name already taken, 100012 no such user. userId is the game account number (accounts.uid), sessionKey becomes its session:
// the game then sends Uin = userId and Session = sessionKey, so the server knows every session it handed out (see LOGIN_LOCK).
// Moving over from Gumptech: a phone this server does not know yet is first looked up at api.gumptech.com (still online in 2026):
// if Gumptech knows it, the player keeps the account number they had. HB_GUMP_PROXY=1 = research mode (pass everything on, log it).
const http = require('http');
const crypto = require('crypto');

const OK = 100000, BAD_PWD = 100010, TAKEN = 100011, NO_USER = 100012, FAIL = 100013;

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS logins (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, device TEXT, email TEXT,
    pwhash TEXT NOT NULL, uid INTEGER NOT NULL, created INTEGER, last INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS logins_guest ON logins(device) WHERE kind='quick';
    CREATE UNIQUE INDEX IF NOT EXISTS logins_email ON logins(email COLLATE NOCASE) WHERE kind='gump';`);
}
const hash = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); };
const check = (pw, h) => {
  const [salt, want] = String(h).split(':');
  const got = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return want && crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
};
const now = () => Date.now();

// a game account (accounts row) for this login: the given uid (moved over from Gumptech) or the next free number
function account(db, uid, name) {
  if (uid && db.prepare('SELECT 1 FROM accounts WHERE uid=?').get(uid)) return uid;
  const user = name + '-' + crypto.randomBytes(4).toString('hex'); // accounts.username is unique and not shown anywhere
  const r = uid ? db.prepare('INSERT INTO accounts(uid,username,password) VALUES(?,?,?)').run(uid, user, '')
    : db.prepare('INSERT INTO accounts(username,password) VALUES(?,?)').run(user, '');
  return Number(uid || r.lastInsertRowid);
}
function answer(db, row, extra = {}) {
  const session = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE accounts SET session=? WHERE uid=?').run(session, row.uid);
  db.prepare('UPDATE logins SET last=? WHERE id=?').run(now(), row.id);
  const nick = row.kind === 'gump' ? row.email : 'User' + row.uid;
  const user = { id: row.uid, appId: 10015, nickname: nick, deviceId: row.device || '', platformId: 4, country: '', avatar: '' };
  return { code: OK, msg: '', nick, userId: row.uid, sessionKey: session, platformId: 4, deviceId: row.device || '', user, ...extra };
}

// Ask Gumptech (the old login server) which account number this phone had. Resolves null when it does not know it or is offline.
function askGumptech(path, form) {
  return new Promise((done) => {
    const body = new URLSearchParams(form).toString();
    const r = http.request({ host: 'api.gumptech.com', port: 80, path, method: 'POST', timeout: 6000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); done(j.code === OK && j.userId ? j : null); } catch { done(null); } });
    });
    r.on('timeout', () => r.destroy());
    r.on('error', () => done(null));
    r.end(body);
  });
}

async function quickLogin(db, p) {
  const dev = String(p.deviceId || '');
  if (!dev) return { code: FAIL };
  let row = db.prepare("SELECT * FROM logins WHERE kind='quick' AND device=?").get(dev);
  if (row) return check(p.passwd || '', row.pwhash) ? answer(db, row) : { code: BAD_PWD, msg: 'this phone is linked to another password' };
  // first time on this server: a phone that played before keeps its old account number if Gumptech still knows it
  const old = process.env.HB_NO_GUMPTECH ? null : await askGumptech('/quick/login.do', { deviceId: dev, appId: p.appId || '10015', passwd: p.passwd || '' });
  const uid = account(db, old ? Number(old.userId) : 0, 'guest');
  db.prepare("INSERT INTO logins(kind,device,pwhash,uid,created) VALUES('quick',?,?,?,?)").run(dev, hash(p.passwd || ''), uid, now());
  return answer(db, db.prepare("SELECT * FROM logins WHERE kind='quick' AND device=?").get(dev));
}
function quickReg(db, p) {
  const dev = String(p.deviceId || '');
  if (!dev) return { code: FAIL };
  let row = db.prepare("SELECT * FROM logins WHERE kind='quick' AND device=?").get(dev);
  const pw = crypto.randomBytes(6).toString('hex'); // the phone keeps this and sends it with every guest login
  if (row) db.prepare('UPDATE logins SET pwhash=? WHERE id=?').run(hash(pw), row.id); // the game was reinstalled on this phone
  else {
    const uid = account(db, 0, 'guest');
    db.prepare("INSERT INTO logins(kind,device,pwhash,uid,created) VALUES('quick',?,?,?,?)").run(dev, hash(pw), uid, now());
  }
  row = db.prepare("SELECT * FROM logins WHERE kind='quick' AND device=?").get(dev);
  return answer(db, row, { passwd: pw, quickRegUser: { id: row.id, email: dev, nickname: 'User' + row.uid, passwd: pw, appId: 10015 } });
}
function gumpReg(db, p) {
  const email = String(p.email || '').trim(), pw = String(p.passwd || '');
  if (email.length < 3 || pw.length < 4) return { code: FAIL, msg: 'name or password too short' };
  if (db.prepare("SELECT 1 FROM logins WHERE kind='gump' AND email=? COLLATE NOCASE").get(email)) return { code: TAKEN };
  const guest = p.deviceId && db.prepare("SELECT * FROM logins WHERE kind='quick' AND device=?").get(String(p.deviceId));
  const uid = guest ? guest.uid : account(db, 0, 'user'); // registering on a phone that plays as a guest names that account
  db.prepare("INSERT INTO logins(kind,device,email,pwhash,uid,created) VALUES('gump',?,?,?,?,?)").run(String(p.deviceId || ''), email, hash(pw), uid, now());
  return answer(db, db.prepare("SELECT * FROM logins WHERE kind='gump' AND email=? COLLATE NOCASE").get(email));
}
function gumpLogin(db, p) {
  const row = db.prepare("SELECT * FROM logins WHERE kind='gump' AND email=? COLLATE NOCASE").get(String(p.email || '').trim());
  if (!row) return { code: NO_USER };
  if (!check(p.passwd || '', row.pwhash)) return { code: BAD_PWD };
  return answer(db, row);
}

function proxy(req, resp, body) {
  const opts = { host: 'api.gumptech.com', port: 80, path: req.url, method: req.method, headers: { ...req.headers, host: 'api.gumptech.com' } };
  const up = http.request(opts, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      const out = Buffer.concat(chunks);
      console.log('[gump]', req.method, req.url, 'BODY', body, '->', r.statusCode, out.toString('utf8').slice(0, 2000));
      resp.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'text/plain' });
      resp.end(out);
    });
  });
  up.on('error', (e) => { console.log('[gump] proxy error', e.message); resp.writeHead(502); resp.end(); });
  up.end(body);
}

async function handle(req, resp, parseBody, db) {
  const body = req.method === 'POST' ? await parseBody(req) : '';
  if (process.env.HB_GUMP_PROXY) return proxy(req, resp, body);
  ensure(db);
  const p = Object.fromEntries(new URLSearchParams(body || (req.url.split('?')[1] || '')));
  const path = req.url.split('?')[0].replace(/\/+/g, '/');
  let out;
  try {
    if (path === '/quick/login.do') out = await quickLogin(db, p);
    else if (path === '/quick/reg.do') out = quickReg(db, p);
    else if (path === '/gump/reg.do') out = gumpReg(db, p);
    else if (path === '/gump/login.do') out = gumpLogin(db, p);
    else out = { code: OK, msg: '', data: { app: {} } }; // ads, push messages, payments: nothing here
  } catch (e) { console.error('login error', e); out = { code: FAIL, msg: 'server error' }; }
  if (/login|reg/.test(path)) console.log(`[login] ${path} -> ${out.code}${out.userId ? ' account ' + out.userId : ''}`);
  resp.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
  resp.end(JSON.stringify(out));
}

// LOGIN_LOCK=1: the game may only enter with a session this server handed out (Revival APKs with the new login). Older APKs
// (their session comes from Gumptech) are refused, so nobody can play an account just by knowing its number.
const locked = () => process.env.LOGIN_LOCK === '1';
module.exports = { handle, ensure, locked };
