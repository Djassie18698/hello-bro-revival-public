// Three more limited-time events (all switched in the Server Manager; prices, rewards and limits are (ours): nothing of them was on the photos):
//  - Diligence gift (Event menu id 33, ui_diligenceGiftLayer): rl_r_multiple_task Cmd 1 list, Cmd 2 AwardID claim. Every N times you do
//    something today (the daily-task counters) you may claim a reward, a few times a day.
//  - Limited discount (id 27, ui_limitDiscountLayer): rl_r_activity Cmd 9004, rl_w_activity Cmd 9100 ActType 10. Top up at least `mincash`
//    gold while it runs and claim a gift worth `maxval` gold. Top-ups are free on this server; they are logged in topup_log.
//  - Lottery (id 22, ui_lotteryTicketLayer): rl_r_lottery Cmd 1 info / 2 my numbers / 3 winners, rl_w_lottery Cmd 1 No = buy, Cmd 2 = claim.
//    A 4-digit number is drawn every day at 20:30 (game text). Prize by digits in the same place as the winning number (game text, example
//    1890: 1790 = 1st, 1692 = 2nd, 1789 = 3rd): 3+ = 1st, 2 = 2nd, 1 = 3rd; only the best prize counts. Tickets: 3 a day, +1 per 6 VIP levels.
const game = require('./game');
const settings = require('./settings');
const vip = require('./vip');

const now = () => Math.floor(Date.now() / 1000);
const day = () => new Date().toISOString().slice(0, 10);
const runLeft = (db, id, days = 14) => Math.max(3600, (settings.switchedOnAt(db, id) || now()) + days * 86400 - now());
const dropRow = (id) => game.table('dropinfo').rows.find((x) => x[0] === id) || [];
const dropName = (id) => String(dropRow(id)[2] || '').replace(/[<>&"]/g, '');
const err = (m) => ({ error: m });

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS diligence_claim (uid INTEGER, server_id INTEGER, day TEXT, task INTEGER, n INTEGER, PRIMARY KEY(uid, server_id, day, task));
    CREATE TABLE IF NOT EXISTS topup_log (uid INTEGER, server_id INTEGER, at INTEGER, gold INTEGER);
    CREATE TABLE IF NOT EXISTS discount_claim (uid INTEGER, server_id INTEGER, run INTEGER, PRIMARY KEY(uid, server_id, run));
    CREATE TABLE IF NOT EXISTS lottery_draw (phase INTEGER PRIMARY KEY, no INTEGER);
    CREATE TABLE IF NOT EXISTS lottery_ticket (uid INTEGER, server_id INTEGER, phase INTEGER, no INTEGER, claimed INTEGER DEFAULT 0)`);
}

// ---- Diligence gift ------------------------------------------------------------------------------------------------
// [id, daily-task counter (dailytask_info id), every N, reward dropinfo id, claims a day, text]
const DILIGENCE = [
  [1, 1, 20, 108, 3, 'Every 20 training fights'],   // 10 Reincarnation Pills
  [2, 6, 5, 1719, 3, 'Every 5 spar wins'],          // 5 Souls Dan
  [3, 5, 5, 239, 2, 'Every 5 sage growths'],        // 20 Sage Stone III
  [4, 4, 5, 107, 2, 'Every 5 arena challenges'],    // 5 Reincarnation Pills
  [5, 17, 3, 1716, 2, 'Every 3 money tree shakes'], // 1 Souls Dan
];
const doneCount = (db, pl, taskId) => (db.prepare('SELECT process FROM dailytask WHERE uid=? AND server_id=? AND day=? AND task_id=?').get(pl.uid, pl.server_id, day(), taskId) || { process: 0 }).process;
const claimedToday = (db, pl, id) => (db.prepare('SELECT n FROM diligence_claim WHERE uid=? AND server_id=? AND day=? AND task=?').get(pl.uid, pl.server_id, day(), id) || { n: 0 }).n;
function diligenceXml(db, pl) {
  if (!settings.eventOn(db, 'diligence')) return null;
  ensure(db);
  game.dailyXml(db, pl.uid, pl.server_id); // makes sure the counters table exists
  const rows = DILIGENCE.map(([id, task, every, drop, times, text]) => {
    const done = doneCount(db, pl, task), used = claimedToday(db, pl, id);
    const left = Math.max(0, times - used), can = Math.max(0, Math.min(left, Math.floor(done / every) - used));
    return `<task id="${id}" desc="${text}" done="${done}" current_recv="${left}" total_recv="${times}" can_recv="${can}"><item id="${drop}" icon="" name="${dropName(drop)}"/></task>`;
  }).join('');
  return `<tasks>${rows}</tasks><remain>${runLeft(db, 'diligence')}</remain>`;
}
function diligenceClaim(db, pl, id) {
  if (!settings.eventOn(db, 'diligence')) return err('the event is over');
  ensure(db);
  const t = DILIGENCE.find((x) => x[0] === id);
  if (!t) return err('no such reward');
  const [, task, every, drop, times] = t;
  const used = claimedToday(db, pl, id);
  if (used >= times) return err("today's rewards have been collected");
  if (Math.floor(doneCount(db, pl, task) / every) <= used) return err('not done yet');
  db.prepare('INSERT INTO diligence_claim VALUES(?,?,?,?,1) ON CONFLICT(uid, server_id, day, task) DO UPDATE SET n=n+1').run(pl.uid, pl.server_id, day(), id);
  return { xml: game.grantDrop(db, pl, drop) || game.awardFull({}) };
}

// ---- Limited discount ----------------------------------------------------------------------------------------------
const DISCOUNT = { mincash: 980, maxval: 3000, drops: [1646, 1820, 1791, 936] }; // Hinata (God), 200 Souls Dan, 300 Reincarnation Pills, 100 Super Ninja Pills
function logTopup(db, uid, sid, gold) { ensure(db); db.prepare('INSERT INTO topup_log VALUES(?,?,?,?)').run(uid, sid, now(), gold); }
const discountRun = (db) => settings.switchedOnAt(db, 'discount') || 0;
function discountState(db, pl) {
  if (db.prepare('SELECT 1 FROM discount_claim WHERE uid=? AND server_id=? AND run=?').get(pl.uid, pl.server_id, discountRun(db))) return 2;
  const paid = db.prepare('SELECT COALESCE(SUM(gold),0) n FROM topup_log WHERE uid=? AND server_id=? AND at>=?').get(pl.uid, pl.server_id, discountRun(db)).n;
  return paid >= DISCOUNT.mincash ? 1 : 0;
}
function discountXml(db, pl) {
  if (!settings.eventOn(db, 'discount')) return null;
  ensure(db);
  const items = DISCOUNT.drops.map((d) => `<item drop="${d}" icon="" name="${dropName(d)}"/>`).join('');
  return `<preview mincash="${DISCOUNT.mincash}" resttime="${runLeft(db, 'discount', 7)}" maxval="${DISCOUNT.maxval}"/><award state="${discountState(db, pl)}">${items}</award>`;
}
function discountClaim(db, pl) {
  if (!settings.eventOn(db, 'discount')) return err('the event is over');
  ensure(db);
  const s = discountState(db, pl);
  if (s === 2) return err('already claimed');
  if (s === 0) return err(`top up ${DISCOUNT.mincash} gold first`);
  db.prepare('INSERT INTO discount_claim VALUES(?,?,?)').run(pl.uid, pl.server_id, discountRun(db));
  return { xml: game.mergeAwards(DISCOUNT.drops.map((d) => game.grantDrop(db, pl, d)).filter(Boolean)) };
}

// ---- Lottery -------------------------------------------------------------------------------------------------------
const LOTTO = { cost: 50, prizes: [1791, 1673, 239] }; // 1st 300 Reincarnation Pills, 2nd 200 Development Dan, 3rd 20 Sage Stone III
// Phase n is drawn at 20:30 (server time) of day n; tickets for it are sold from 20:30 the day before until 20:00 on day n.
const DRAW_MIN = 20 * 60 + 30, BET_END_MIN = 20 * 60;
// phase = local day number of the draw day
const dayIndex = (d) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
function phaseAt(t) {
  const d = new Date(t * 1000), mins = d.getHours() * 60 + d.getMinutes();
  return dayIndex(new Date(d.getFullYear(), d.getMonth(), d.getDate())) + (mins >= DRAW_MIN ? 1 : 0);
}
function drawTimes(phase) { // 20:00 (betting ends) and 20:30 (draw) on the draw day, server time
  const u = new Date(phase * 86400000), day0 = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime() / 1000;
  return { betEnd: day0 + BET_END_MIN * 60, draw: day0 + DRAW_MIN * 60 };
}
function winning(db, phase) { // drawn lazily the first time someone looks after 20:30
  if (now() < drawTimes(phase).draw) return 0;
  let r = db.prepare('SELECT no FROM lottery_draw WHERE phase=?').get(phase);
  if (!r) { r = { no: Math.floor(Math.random() * 10000) }; db.prepare('INSERT OR IGNORE INTO lottery_draw VALUES(?,?)').run(phase, r.no); r = db.prepare('SELECT no FROM lottery_draw WHERE phase=?').get(phase); }
  return r.no;
}
const digits = (n) => String(n).padStart(4, '0').split('');
function prizeOf(no, win) {
  const same = digits(no).filter((c, i) => c === digits(win)[i]).length;
  return same >= 3 ? 1 : same === 2 ? 2 : same === 1 ? 3 : 0;
}
const ticketsLeft = (db, pl, phase) => 3 + Math.floor(vip.level(db, pl.uid, pl.server_id) / 6) - db.prepare('SELECT COUNT(*) n FROM lottery_ticket WHERE uid=? AND server_id=? AND phase=?').get(pl.uid, pl.server_id, phase).n;
function myBest(db, pl, phase) {
  if (now() < drawTimes(phase).draw) return 0;
  const win = winning(db, phase);
  return db.prepare('SELECT no FROM lottery_ticket WHERE uid=? AND server_id=? AND phase=?').all(pl.uid, pl.server_id, phase)
    .map((t) => prizeOf(t.no, win)).filter(Boolean).sort()[0] || 0;
}
function lotteryXml(db, pl, cmd) {
  if (!settings.eventOn(db, 'lottery')) return null;
  ensure(db);
  const phase = phaseAt(now()), last = phase - 1, t = drawTimes(phase);
  const mine = (ph) => db.prepare('SELECT no FROM lottery_ticket WHERE uid=? AND server_id=? AND phase=? ORDER BY rowid').all(pl.uid, pl.server_id, ph)
    .map((x) => `<no>${String(x.no).padStart(4, '0')}</no>`).join('');
  if (cmd === 2) return `<current_no>${mine(phase)}</current_no><last_no>${mine(last)}</last_no>`;
  if (cmd === 3) {
    const win = winning(db, last);
    const rows = db.prepare('SELECT t.no, p.nick, p.server_id FROM lottery_ticket t JOIN players p ON p.uid=t.uid AND p.server_id=t.server_id WHERE t.phase=?').all(last)
      .map((x) => ({ ...x, pt: prizeOf(x.no, win) })).filter((x) => x.pt).sort((a, b) => a.pt - b.pt).slice(0, 50);
    return '<lottery>' + rows.map((x) => `<item pt="${x.pt}" zone="${x.server_id}" nick="${String(x.nick).replace(/[<>&"]/g, '')}"/>`).join('') + '</lottery>';
  }
  return `<award_list>${LOTTO.prizes.map((d) => `<drop>${d}</drop>`).join('')}</award_list>` +
    `<lottery><phase>${Math.max(1, phase - phaseAt(settings.switchedOnAt(db, 'lottery') || now()) + 1)}</phase><lottery_ts>${t.draw}</lottery_ts><last_no>${winning(db, last)}</last_no><cost_cash>${LOTTO.cost}</cost_cash>` +
    `<player_prize>${myBest(db, pl, last)}</player_prize><bet_end_ts>${t.betEnd}</bet_end_ts></lottery>`;
}
function lotteryBuy(db, pl, noText) {
  if (!settings.eventOn(db, 'lottery')) return err('the event is over');
  ensure(db);
  const no = Number(noText);
  if (!/^\d{1,4}$/.test(String(noText || '').trim()) || no < 0 || no > 9999) return err('pick a 4-digit number');
  const phase = phaseAt(now());
  if (now() >= drawTimes(phase).betEnd) return err('betting has ended, wait for the draw');
  if (ticketsLeft(db, pl, phase) <= 0) return err('no tickets left today');
  if (pl.gold < LOTTO.cost) return err('not enough gold');
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(LOTTO.cost, pl.uid, pl.server_id);
  db.prepare('INSERT INTO lottery_ticket(uid, server_id, phase, no) VALUES(?,?,?,?)').run(pl.uid, pl.server_id, phase, no);
  return { xml: '' };
}
function lotteryClaim(db, pl) {
  if (!settings.eventOn(db, 'lottery')) return err('the event is over');
  ensure(db);
  const last = phaseAt(now()) - 1;
  const best = myBest(db, pl, last);
  if (!best) return err('no prize this time');
  const open = db.prepare('SELECT COUNT(*) n FROM lottery_ticket WHERE uid=? AND server_id=? AND phase=? AND claimed=0').get(pl.uid, pl.server_id, last).n;
  if (!open) return err('already claimed');
  db.prepare('UPDATE lottery_ticket SET claimed=1 WHERE uid=? AND server_id=? AND phase=?').run(pl.uid, pl.server_id, last);
  return { xml: game.grantDrop(db, pl, LOTTO.prizes[best - 1]) || game.awardFull({}) };
}

module.exports = { ensure, diligenceXml, diligenceClaim, logTopup, discountXml, discountClaim, lotteryXml, lotteryBuy, lotteryClaim, prizeOf, phaseAt };
