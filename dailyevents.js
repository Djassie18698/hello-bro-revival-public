// Two small daily events, each switched on in the Server Manager. Screens and texts are the client's own; no photo shows their
// prices or rewards, so every number here is (ours).
//  - Daily spending gift (Event menu id 25, ui_dailyPayLayer, "consume the specified amount of gold ... recalculated everyday"):
//    rl_w_dailycost Cmd 1 = <basic><cost/><remain/></basic><award_list><item id cost has_got><award><item id name icon/></award></item></award_list>,
//    Cmd 2 Award = claim tier N.
//  - Recharge streak (id 26, ui_keepPayLayer, "Recharge Streak: N D", 7 days): rl_r_activity Cmd 9003 =
//    <preview days resttime/><awardlist><item id state><award><item drop name icon/></award></item></awardlist><ext_award state><item drop name icon/></ext_award>,
//    rl_w_activity ActType 9: ActID 1 = claim the next day reached, ActID 2 = the extra gift for all 7 days.
const game = require('./game');
const settings = require('./settings');

const RUN_DAYS = 7;
const now = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
const dayStart = () => Math.floor(Date.parse(today() + 'T00:00:00Z') / 1000);
const dayEnd = () => dayStart() + 86400 - now();
const runLeft = (db, id) => Math.max(0, (settings.switchedOnAt(db, id) || now()) + RUN_DAYS * 86400 - now());
const dropRow = (id) => game.table('dropinfo').rows.find((x) => x[0] === id) || [];
const ICON = { 7: 'props_034', 8: 'props_035', 11: 'props_033', 22: 'props_129', 23: 'props_128', 28: 'props_145', 30: 'props_170', 31: 'props_169', 34: 'props_229', 35: 'props_260' };
const iconOf = (d) => ICON[dropRow(d)[7]] || 'props_033';
const nameOf = (d) => String(dropRow(d)[13] || 1); // just the amount under the icon (long item names overlap in these cells)
const itemXml = (d, key = 'id') => `<item ${key}="${d}" name="${nameOf(d)}" icon="${iconOf(d)}"/>`;
const pay = (db, pl, drops) => game.mergeAwards(drops.map((d) => game.grantDrop(db, pl, d)).filter(Boolean));
const err = (m) => ({ error: m });

function ensure(db) {
  require('./consumption').ensure(db); // gold_spent log
  require('./limited').ensure(db); // topup_log
  db.exec(`CREATE TABLE IF NOT EXISTS daily_event_claim (uid INTEGER, server_id INTEGER, ev TEXT, run TEXT, item INTEGER, n INTEGER, PRIMARY KEY(uid, server_id, ev, run, item))`);
}
const claims = (db, pl, ev, run, item) => (db.prepare('SELECT n FROM daily_event_claim WHERE uid=? AND server_id=? AND ev=? AND run=? AND item=?').get(pl.uid, pl.server_id, ev, String(run), item) || { n: 0 }).n;
const addClaim = (db, pl, ev, run, item) => db.prepare('INSERT INTO daily_event_claim VALUES (?,?,?,?,?,1) ON CONFLICT(uid, server_id, ev, run, item) DO UPDATE SET n=n+1').run(pl.uid, pl.server_id, ev, String(run), item);

// ---- Daily spending gift (ours) ----------------------------------------------------------------------------------------
const COST_TIERS = [ // [gold spent today, dropinfo ids]
  [100, [107, 1717]],          // 5 Reincarnation Pills, 2 Souls Dan
  [500, [110, 877, 1298]],     // 20 Reincarnation Pills, 20 Super Ninja Pills, 2 Refresh Orders
  [1000, [112, 1721, 563]],    // 30 Reincarnation Pills, 10 Souls Dan, 2 Silver Keys
  [2000, [116, 906, 565]],     // 50 Reincarnation Pills, 50 Super Ninja Pills, 2 Gold Keys
];
const spentToday = (db, pl) => db.prepare('SELECT COALESCE(SUM(amount),0) n FROM gold_spent WHERE uid=? AND server_id=? AND at>=?').get(pl.uid, pl.server_id, dayStart()).n;
function costXml(db, pl) {
  if (!settings.eventOn(db, 'dailycost')) return null;
  ensure(db);
  const items = COST_TIERS.map(([cost, drops], i) => `<item id="${i + 1}" cost="${cost}" has_got="${claims(db, pl, 'cost', today(), i + 1) ? 1 : 0}"><award>${drops.map((d) => itemXml(d)).join('')}</award></item>`).join('');
  return `<basic><cost>${spentToday(db, pl)}</cost><remain>${runLeft(db, 'dailycost')}</remain></basic><award_list>${items}</award_list>`;
}
function costClaim(db, pl, n) {
  if (!settings.eventOn(db, 'dailycost') || !runLeft(db, 'dailycost')) return err('The event is over');
  ensure(db);
  const t = COST_TIERS[n - 1];
  if (!t) return err('no such reward');
  if (claims(db, pl, 'cost', today(), n)) return err('already claimed today');
  if (spentToday(db, pl) < t[0]) return err(`spend ${t[0]} gold today first`);
  addClaim(db, pl, 'cost', today(), n);
  return { xml: pay(db, pl, t[1]) };
}

// ---- Recharge streak (ours) --------------------------------------------------------------------------------------------
const STREAK = [[107, 1717], [108, 1718], [110, 877], [110, 1719], [112, 909], [112, 1721], [116, 906]]; // day 1-7
const STREAK_EXTRA = [1791, 1820]; // all 7 days: 300 Reincarnation Pills, 200 Souls Dan
const streakRun = (db) => settings.switchedOnAt(db, 'keeppay') || 0;
// a day counts when $3 or more was topped up that day (the screen's own text: "Top up 3 dollars and get the rewards.")
const streakDays = (db, pl) => Math.min(7, db.prepare(`SELECT COUNT(*) n FROM (SELECT date(at, 'unixepoch') d FROM topup_log WHERE uid=? AND server_id=? AND at>=? GROUP BY d HAVING SUM(cents) >= 300)`).get(pl.uid, pl.server_id, streakRun(db)).n);
function streakXml(db, pl) {
  if (!settings.eventOn(db, 'keeppay')) return null;
  ensure(db);
  const days = streakDays(db, pl), run = streakRun(db);
  const items = STREAK.map((drops, i) => `<item id="${i + 1}" state="${claims(db, pl, 'streak', run, i + 1) ? 2 : i < days ? 1 : 0}"><award>${drops.map((d) => itemXml(d, 'drop')).join('')}</award></item>`).join('');
  const extra = claims(db, pl, 'streak', run, 8) ? 2 : days >= 7 ? 1 : 0;
  return `<preview days="${days}" resttime="${runLeft(db, 'keeppay')}"/><awardlist>${items}</awardlist><ext_award state="${extra}">${STREAK_EXTRA.map((d) => itemXml(d, 'drop')).join('')}</ext_award>`;
}
function streakClaim(db, pl, actId) {
  if (!settings.eventOn(db, 'keeppay') || !runLeft(db, 'keeppay')) return err('The event is over');
  ensure(db);
  const days = streakDays(db, pl), run = streakRun(db);
  if (actId === 2) {
    if (days < 7) return err('top up on 7 different days first');
    if (claims(db, pl, 'streak', run, 8)) return err('already claimed');
    addClaim(db, pl, 'streak', run, 8);
    return { xml: pay(db, pl, STREAK_EXTRA) };
  }
  const i = STREAK.findIndex((_, k) => k < days && !claims(db, pl, 'streak', run, k + 1));
  if (i < 0) return err(days ? 'already claimed' : 'top up first');
  addClaim(db, pl, 'streak', run, i + 1);
  return { xml: pay(db, pl, STREAK[i]) };
}

module.exports = { costXml, costClaim, streakXml, streakClaim };
// Not built: the limited daily gift (id 30, rl_r_dailylimit): v28's activity/DailyRestrictionCell.ccbi has none of the price, remain,
// buy-button and item-name nodes ui_dailyRestrictionCell.lua reads, so the screen crashes whatever the server sends.
