// Hot Treasure (Event menu id 43, business_proxy/hotTreasure_business -> ui_hotTreasure, rl_x_small_activity):
// Cmd 12 info, 13 one hunt (free ones first), 14 ten hunts. Game texts: "heat" = top prize, "semi-heat" = second prizes,
// "100% rate to get heat reward in 10 draw". Nothing of this event was on the photos so far, so prices, prizes and chances are (ours).
const game = require('./game');
const settings = require('./settings');

const COST = { one: 100, ten: 900 };
const FREE_PER_DAY = 1;
const RUN_DAYS = 14;
// [dropinfo id, weight]; MAIN is the heat prize (one in every ten hunts for sure), SEMI the semi-heat prizes, the rest fill the pool
const MAIN = [1643, 1];                                   // Goddess Sakura (God)
const SEMI = [[1719, 4], [108, 6], [239, 6], [1673, 4]];  // 5 Souls Dan, 10 Reincarnation Pills, 20 Sage Stone III, 200 Development Dan
const REST = [[250, 30], [252, 20], [107, 15], [1716, 15], [1717, 9]]; // 1-2 Sage Stone III, 5 Reincarnation Pills, 1-2 Souls Dan

const day = () => new Date().toISOString().slice(0, 10);
const ensure = (db) => db.exec('CREATE TABLE IF NOT EXISTS hottreasure (uid INTEGER, server_id INTEGER, day TEXT, free_used INTEGER DEFAULT 0, PRIMARY KEY(uid, server_id))');
function freeLeft(db, pl) {
  ensure(db);
  const r = db.prepare('SELECT * FROM hottreasure WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  return r && r.day === day() ? Math.max(0, FREE_PER_DAY - r.free_used) : FREE_PER_DAY;
}
function useFree(db, pl) {
  const r = db.prepare('SELECT * FROM hottreasure WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  const used = r && r.day === day() ? r.free_used + 1 : 1;
  db.prepare('INSERT INTO hottreasure VALUES(?,?,?,?) ON CONFLICT(uid, server_id) DO UPDATE SET day=excluded.day, free_used=excluded.free_used').run(pl.uid, pl.server_id, day(), used);
}
const on = (db) => settings.eventOn(db, 'hottreasure');
const left = (db) => Math.max(3600, (settings.switchedOnAt(db, 'hottreasure') || Math.floor(Date.now() / 1000)) + RUN_DAYS * 86400 - Math.floor(Date.now() / 1000));

// <item> for the screen: main_type/sub_type/prop_id decide the icon (rl_get_iconsprite)
function itemXml(dropId) {
  const r = game.table('dropinfo').rows.find((x) => x[0] === dropId) || [];
  const [type, sub, id] = r[8] ? [5, 0, r[8]] : r[7] ? [2, 0, r[7]] : r[5] ? [1, 4, r[5]] : [1, 1, r[3]];
  return `<item><drop_id>${dropId}</drop_id><desc>${String(r[2] || '').replace(/[<>&]/g, '')}</desc><main_type>${type}</main_type><sub_type>${sub}</sub_type><prop_id>${id}</prop_id></item>`;
}
function infoXml(db, pl) {
  if (!on(db)) return null;
  const all = [MAIN, ...SEMI, ...REST].map(([d]) => itemXml(d)).join('');
  return `<remain_time>${left(db)}</remain_time><one_cost>${COST.one}</one_cost><ten_cost>${COST.ten}</ten_cost>` +
    `<main>${itemXml(MAIN[0])}</main><second>${SEMI.map(([d]) => itemXml(d)).join('')}</second><all>${all}</all><left_free_count>${freeLeft(db, pl)}</left_free_count>`;
}
function roll() {
  const pool = [MAIN, ...SEMI, ...REST];
  let n = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
  for (const [d, w] of pool) { n -= w; if (n < 0) return d; }
  return REST[0][0];
}
const gold = (db, pl) => db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id).gold;
function huntOne(db, pl) {
  if (!on(db)) return { error: 'the event is over' };
  const free = freeLeft(db, pl) > 0;
  if (!free && pl.gold < COST.one) return { error: 'not enough gold' };
  if (free) useFree(db, pl); else db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(COST.one, pl.uid, pl.server_id);
  const award = game.grantDrop(db, pl, roll()) || game.awardFull({});
  return { xml: `<cash>${gold(db, pl)}</cash><left_free_count>${freeLeft(db, pl)}</left_free_count>${award}` };
}
function huntTen(db, pl) {
  if (!on(db)) return { error: 'the event is over' };
  if (pl.gold < COST.ten) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(COST.ten, pl.uid, pl.server_id);
  const drops = Array.from({ length: 10 }, roll);
  if (!drops.includes(MAIN[0])) drops[Math.floor(Math.random() * 10)] = MAIN[0]; // the heat prize is certain in ten hunts
  const awards = drops.map((d) => game.grantDrop(db, pl, d) || '').join('');
  return { xml: `<cash>${gold(db, pl)}</cash><award_list>${awards}</award_list>` };
}

module.exports = { infoXml, huntOne, huntTen };
