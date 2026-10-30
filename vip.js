// VIP system: VIP level per player (offline server: free, set from the admin page), VIP gift shop, free "top-up".
const game = require('./game');
const drops = require('./drops');
const el = (n, v) => `<${n}>${v}</${n}>`;
const DEFAULT_VIP = 0; // like the original: VIP comes from (free) top-ups
const MAX_VIP = 18;
// VIP exp = total topped up in dollars x 10 (the client shows (lvexp-exp)/10 as "$ to next VIP").
// Cumulative exp per level; the original thresholds lived on the dead server, these are ours ($1, $10, $30 ... $50000).
const VIP_EXP = [0, 10, 100, 300, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 50000, 80000, 120000, 200000, 300000, 500000];

let migrated = false;
function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vipstate (uid INTEGER, server_id INTEGER, level INTEGER, PRIMARY KEY(uid,server_id));
    CREATE TABLE IF NOT EXISTS vipbought (uid INTEGER, server_id INTEGER, gift_id INTEGER, PRIMARY KEY(uid,server_id,gift_id));
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`);
  if (migrated) return;
  migrated = true;
  try { db.exec('ALTER TABLE vipstate ADD COLUMN exp INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* already there */ }
  // one time: players made before 30 Oct 2026 12:00 UTC (when everyone was VIP 18) keep it; only new characters start at VIP 0
  if (!db.prepare("SELECT 1 FROM meta WHERE k='vip0'").get()) {
    db.prepare(`INSERT OR IGNORE INTO vipstate(uid,server_id,level,exp) SELECT uid, server_id, ?, ? FROM players WHERE created < ?`).run(MAX_VIP, VIP_EXP[MAX_VIP], Date.parse('2026-10-30T12:00:00Z'));
    db.prepare("INSERT INTO meta VALUES('vip0','1')").run();
  }
}
const levelOf = (exp) => { let lv = 0; while (lv < MAX_VIP && exp >= VIP_EXP[lv + 1]) lv++; return lv; };
function expOf(db, uid, sid) {
  ensure(db);
  const r = db.prepare('SELECT level, exp FROM vipstate WHERE uid=? AND server_id=?').get(uid, sid);
  return r ? Math.max(r.exp, VIP_EXP[r.level] || 0) : 0;
}
// Top-up: add dollars x 10 to VIP exp and move the level up when a threshold is passed.
function addExp(db, uid, sid, n) {
  const exp = expOf(db, uid, sid) + Math.max(0, Math.round(n));
  db.prepare('INSERT INTO vipstate(uid,server_id,level,exp) VALUES(?,?,?,?) ON CONFLICT(uid,server_id) DO UPDATE SET level=excluded.level, exp=excluded.exp')
    .run(uid, sid, levelOf(exp), exp);
}
// For the top-up screen: <exp>/<lvexp> of the current level.
function progress(db, uid, sid) {
  const exp = expOf(db, uid, sid), lv = levelOf(exp);
  return { lv, exp, lvexp: VIP_EXP[Math.min(lv + 1, MAX_VIP)] };
}
function level(db, uid, sid) {
  ensure(db);
  const r = db.prepare('SELECT level FROM vipstate WHERE uid=? AND server_id=?').get(uid, sid);
  return r ? r.level : DEFAULT_VIP;
}
function setLevel(db, uid, sid, lv) {
  ensure(db);
  lv = Math.max(0, Math.min(MAX_VIP, Math.trunc(lv) || 0));
  db.prepare('INSERT INTO vipstate(uid,server_id,level,exp) VALUES(?,?,?,?) ON CONFLICT(uid,server_id) DO UPDATE SET level=excluded.level, exp=excluded.exp').run(uid, sid, lv, VIP_EXP[lv]);
  return lv;
}

const gifts = () => game.table('vip_gift').rows.filter((r) => r[0] >= 1 && r[0] <= MAX_VIP + 5 && r[0] <= 23);

function listXml(db, pl) {
  ensure(db);
  const lv = level(db, pl.uid, pl.server_id);
  const bought = new Set(db.prepare('SELECT gift_id FROM vipbought WHERE uid=? AND server_id=?').all(pl.uid, pl.server_id).map((r) => r.gift_id));
  const items = gifts().map((g) => {
    const canbuy = bought.has(g[0]) ? 1 : lv >= g[1] ? 2 : 0;
    // child order matters: the client sets the 3rd child to 1 after a purchase (canbuy)
    return `<vipgift id="${g[0]}">${el('vip', g[1])}${el('giftid', g[0])}${el('canbuy', canbuy)}${el('price', g[2])}${el('orgin_price', g[11])}${el('desc', String(g[10]).replace(/[<>&]/g, ' '))}${el('icon', g[3])}</vipgift>`;
  }).join('');
  const exp = VIP_EXP[lv], next = VIP_EXP[Math.min(lv + 1, MAX_VIP)];
  return el('lv', lv) + el('exp', exp) + el('lvexp', next) + `<vipshoplist>${items}</vipshoplist>`;
}

function buy(db, pl, giftId) {
  ensure(db);
  const g = gifts().find((r) => r[0] === giftId);
  if (!g) return { error: 'no such gift' };
  if (level(db, pl.uid, pl.server_id) < g[1]) return { error: 'vip level too low' };
  if (db.prepare('SELECT 1 FROM vipbought WHERE uid=? AND server_id=? AND gift_id=?').get(pl.uid, pl.server_id, giftId)) return { error: 'already bought' };
  if (pl.gold < g[2]) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(g[2], pl.uid, pl.server_id);
  db.prepare('INSERT INTO vipbought(uid,server_id,gift_id) VALUES(?,?,?)').run(pl.uid, pl.server_id, giftId);
  const out = drops.newOut();
  [4, 5, 6, 7, 8].forEach((i) => g[i] && drops.give(db, pl, g[i], out));
  drops.settle(db, pl, out);
  return { xml: drops.awardXml(out) };
}

module.exports = { level, setLevel, addExp, progress, listXml, buy, MAX_VIP, DEFAULT_VIP };
