// VIP system: VIP level per player (offline server: free, set from the admin page), VIP gift shop, free "top-up".
const game = require('./game');
const drops = require('./drops');
const el = (n, v) => `<${n}>${v}</${n}>`;
const DEFAULT_VIP = 18; // everybody starts with max VIP; nothing is paid for here
const MAX_VIP = 18;
// Cumulative exp needed for each VIP level (index = level). Client shows (lvexp-exp)/10 as "ingots to next VIP".
const VIP_EXP = [0, 100, 1000, 3000, 6000, 10000, 20000, 30000, 50000, 80000, 120000, 200000, 300000, 500000, 800000, 1200000, 2000000, 4000000, 8000000];

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS vipstate (uid INTEGER, server_id INTEGER, level INTEGER, PRIMARY KEY(uid,server_id));
    CREATE TABLE IF NOT EXISTS vipbought (uid INTEGER, server_id INTEGER, gift_id INTEGER, PRIMARY KEY(uid,server_id,gift_id))`);
}
function level(db, uid, sid) {
  ensure(db);
  const r = db.prepare('SELECT level FROM vipstate WHERE uid=? AND server_id=?').get(uid, sid);
  return r ? r.level : DEFAULT_VIP;
}
function setLevel(db, uid, sid, lv) {
  ensure(db);
  lv = Math.max(0, Math.min(MAX_VIP, Math.trunc(lv) || 0));
  db.prepare('INSERT INTO vipstate(uid,server_id,level) VALUES(?,?,?) ON CONFLICT(uid,server_id) DO UPDATE SET level=excluded.level').run(uid, sid, lv);
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

module.exports = { level, setLevel, listXml, buy, MAX_VIP, DEFAULT_VIP };
