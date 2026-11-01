// Monthly sign-in (ui_monthSign.lua). rl_x_small_activity Cmd 7 = month list, Cmd 8 = sign (SignId).
// 28 slots per month (the client lays them out 4 per row). status: 0 can sign, 1 signed, 2 signed once but your VIP level now earns the
// double (sign again for the second copy), 3 not reached yet. need_vip = "vN": VIP N or higher gets the reward twice.
// ORIGINAL (Facebook photos 0516, 1871, 1884, the May / July screens): day 1 10 000 silver (v1), 2 20 gold, 3 3 Recruitment Orders (v2),
// 4 shinobi card (v3), 5 3 Refresh Orders, 6 25 000 silver (v3), 7 5 Development Dan (v4), 8 50 gold, 9 card (v5), 10 5 Refresh Orders,
// 11 20 Sage Stone III (v5), 12 card (v6), 13 15 Reincarnation Pills, 14 30 000 silver, 15 6 Development Dan (v7), 16 50 gold (v8).
// (ours): which cards (4-star pack on days 4 / 9, 5-star pack on day 12) and days 17-28 (days 5-16 again, VIP marks +4, at most v15).
const game = require('./game');
const el = (n, v) => `<${n}>${v}</${n}>`;
// [kind, amount or dropinfo id, shown dropinfo id, icon, need_vip]; kind coin = silver, cash = gold, drop = a dropinfo row
const FIRST16 = [
  ['coin', 10000, 56, 'props_036', 1], ['cash', 20, 97, 'props_037', 0], ['drop', 1287, 1287, 'props_170', 2], ['drop', 10, 10, 'props_009', 3],
  ['drop', 1299, 1299, 'props_169', 0], ['coin', 25000, 56, 'props_036', 3], ['drop', 1531, 1531, 'props_229', 4], ['cash', 50, 100, 'props_037', 0],
  ['drop', 10, 10, 'props_009', 5], ['drop', 1301, 1301, 'props_169', 0], ['drop', 239, 239, 'props_035', 5], ['drop', 11, 11, 'props_015', 6],
  ['drop', 109, 109, 'props_033', 0], ['coin', 30000, 226, 'props_036', 0], ['drop', 1532, 1532, 'props_229', 7], ['cash', 50, 100, 'props_037', 8],
];
const DAYS = [...FIRST16, ...FIRST16.slice(4).map((r) => [...r.slice(0, 4), r[4] ? Math.min(15, r[4] + 4) : 0])];
const shownNum = (r) => (r[0] === 'drop' ? (game.table('dropinfo').rows.find((x) => x[0] === r[1]) || [])[13] || 1 : r[1]);
const ym = () => new Date().toISOString().slice(0, 7);

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS monthsign (uid INTEGER, server_id INTEGER, ym TEXT, day INTEGER, PRIMARY KEY(uid,server_id,ym,day))');
  try { db.exec('ALTER TABLE monthsign ADD COLUMN date TEXT'); } catch (e) { /* already there */ }
  try { db.exec('ALTER TABLE monthsign ADD COLUMN copies INTEGER NOT NULL DEFAULT 1'); } catch (e) { /* already there */ }
}
// One slot opens per calendar day, in order: the next unsigned slot is open only if nothing was signed today (owner: every slot showed as claimable).
const todayStr = () => new Date().toISOString().slice(0, 10);
const rows = (db, pl) => new Map(db.prepare('SELECT day, copies FROM monthsign WHERE uid=? AND server_id=? AND ym=?').all(pl.uid, pl.server_id, ym()).map((r) => [r.day, r.copies]));
function nextOpen(db, pl, done) {
  if (db.prepare('SELECT 1 FROM monthsign WHERE uid=? AND server_id=? AND ym=? AND date=?').get(pl.uid, pl.server_id, ym(), todayStr())) return 0;
  return done.size + 1 <= 28 ? done.size + 1 : 0;
}
const copiesFor = (db, pl, d) => (DAYS[d - 1][4] && require('./vip').level(db, pl.uid, pl.server_id) >= DAYS[d - 1][4] ? 2 : 1);

function listXml(db, pl) {
  ensure(db);
  const done = rows(db, pl), open = nextOpen(db, pl, done);
  let items = '';
  for (let d = 1; d <= 28; d++) {
    const r = DAYS[d - 1];
    const status = done.has(d) ? (done.get(d) < copiesFor(db, pl, d) ? 2 : 1) : d === open ? 0 : 3;
    items += `<signitem>${el('sign_id', d)}${el('need_vip', r[4])}${el('award_id', r[2])}${el('award_icon', r[3])}${el('award_num', shownNum(r))}${el('status', status)}</signitem>`;
  }
  return `<user>${el('days', done.size)}</user><month mth="${Number(ym().slice(5))}">${items}</month>`;
}

function pay(db, pl, r, times) {
  const awards = [];
  for (let i = 0; i < times; i++) {
    if (r[0] === 'drop') awards.push(game.grantDrop(db, pl, r[1]));
    else {
      db.prepare(`UPDATE players SET ${r[0] === 'coin' ? 'coin' : 'gold'}=${r[0] === 'coin' ? 'coin' : 'gold'}+? WHERE uid=? AND server_id=?`).run(r[1], pl.uid, pl.server_id);
      awards.push(game.awardFull({ [r[0]]: r[1] }));
    }
  }
  return game.mergeAwards(awards.filter(Boolean));
}

function sign(db, pl, signId) {
  ensure(db);
  const done = rows(db, pl), r = DAYS[signId - 1];
  if (!r) return { error: 'no such day' };
  const want = copiesFor(db, pl, signId);
  if (done.has(signId)) { // the second copy after a VIP-up (status 2)
    const had = done.get(signId);
    if (had >= want) return { error: 'already signed' };
    db.prepare('UPDATE monthsign SET copies=? WHERE uid=? AND server_id=? AND ym=? AND day=?').run(want, pl.uid, pl.server_id, ym(), signId);
    return { xml: pay(db, pl, r, want - had) };
  }
  if (signId !== nextOpen(db, pl, done)) return { error: 'not available yet' };
  db.prepare('INSERT INTO monthsign(uid,server_id,ym,day,date,copies) VALUES(?,?,?,?,?,?)').run(pl.uid, pl.server_id, ym(), signId, todayStr(), want);
  return { xml: pay(db, pl, r, want) };
}

module.exports = { listXml, sign };
