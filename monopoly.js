// Millionaire / Monopoly (activity 17 on the home screen, ui_monopolyLayer.lua). A 20-cell board: each throw (gold)
// moves 1-3 cells and wins that cell's prize; 10 throws at once is a button too. Steps walked this week count for the
// step ranking (rl_r_monopoly_rank) with progress rewards (claim any time once reached) and rank rewards (claim for last
// week's rank). The event runs weekly, Monday to Sunday (UTC). Board, prices and rewards are ours: the originals were
// server-side and are lost.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COST = 20, LIMIT = 50; // gold per throw, steps needed to appear in the rank rewards
// [dropid, icon] for the 20 cells, clockwise from the start
const BOARD = [[506, 'props_036'], [33, 'props_017'], [270, 'props_034'], [98, 'props_037'], [1397, 'props_170'],
  [42, 'props_036'], [1784, 'props_320'], [241, 'props_035'], [36, 'props_017'], [1306, 'props_169'],
  [100, 'props_037'], [114, 'props_033'], [1785, 'props_321'], [43, 'props_036'], [1398, 'props_170'],
  [99, 'props_037'], [38, 'props_017'], [270, 'props_034'], [1446, 'props_189'], [506, 'props_036']];
// rank rewards: places 1, 2, 3, 4-10; progress rewards at 50 / 100 / 200 / 400 steps (AwardID 5-8)
const RANK = [[1446, 'props_189', 6], [1453, 'props_170', 5], [242, 'props_035', 5], [1398, 'props_170', 4]];
const STEPS = [[50, 1397, 'props_170', 4], [100, 1306, 'props_169', 4], [200, 241, 'props_035', 5], [400, 1452, 'props_170', 5]];

const DAY = 86400000;
const week = (t = Date.now()) => Math.floor((t / DAY + 3) / 7); // weeks since 1970, starting on Monday
function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS monopoly (uid INTEGER, server_id INTEGER, week INTEGER, cell INTEGER DEFAULT 1,
      steps INTEGER DEFAULT 0, claimed TEXT DEFAULT '', PRIMARY KEY(uid, server_id, week));
    CREATE TABLE IF NOT EXISTS monopoly_rank_claim (uid INTEGER, server_id INTEGER, week INTEGER, PRIMARY KEY(uid, server_id, week))`);
}
function me(db, pl) {
  ensure(db);
  const w = week();
  const prev = db.prepare('SELECT cell FROM monopoly WHERE uid=? AND server_id=? ORDER BY week DESC LIMIT 1').get(pl.uid, pl.server_id);
  db.prepare('INSERT OR IGNORE INTO monopoly(uid,server_id,week,cell) VALUES(?,?,?,?)').run(pl.uid, pl.server_id, w, prev ? prev.cell : 1);
  return db.prepare('SELECT * FROM monopoly WHERE uid=? AND server_id=? AND week=?').get(pl.uid, pl.server_id, w);
}

function infoXml(db, pl) {
  const m = me(db, pl);
  const rest = Math.floor(((week() + 1) * 7 - 3) * DAY / 1000 - Date.now() / 1000);
  return '<basic_info>' + el('remaining_time', rest) + el('cell_index', m.cell) + '</basic_info>' + el('cost_cash', COST) +
    `<cell_list>${BOARD.map(([id, icon]) => `<cell id="${id}" icon="${icon}"/>`).join('')}</cell_list>`;
}
function spend(db, pl, gold) {
  const p = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (p.gold < gold) return false;
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(gold, pl.uid, pl.server_id);
  return true;
}
// Cmd 1 = one throw, Cmd 2 = ten throws. Cells are 1..20; walking past 20 goes round the board.
function roll(db, pl, times) {
  const m = me(db, pl);
  if (!spend(db, pl, COST * times)) return { error: 'not enough gold' };
  let cell = m.cell, steps = 0, last = 1;
  const list = [];
  for (let i = 0; i < times; i++) {
    last = 1 + Math.floor(Math.random() * 3);
    steps += last;
    cell = ((cell - 1 + last) % 20) + 1;
    list.push(`<item>${el('cell_index', cell)}${game.grantDrop(db, pl, BOARD[cell - 1][0])}</item>`);
  }
  db.prepare('UPDATE monopoly SET cell=?, steps=steps+? WHERE uid=? AND server_id=? AND week=?').run(cell, steps, pl.uid, pl.server_id, week());
  return { xml: el('dice', last) + el('cell_index', cell) + `<reward_list>${list.join('')}</reward_list>` };
}
function ranking(db, sid, w) {
  ensure(db);
  return db.prepare(`SELECT m.uid, m.steps, p.nick, p.country FROM monopoly m JOIN players p ON p.uid=m.uid AND p.server_id=m.server_id
    WHERE m.server_id=? AND m.week=? AND m.steps>0 ORDER BY m.steps DESC, m.uid LIMIT 50`).all(sid, w);
}
const rankRow = (place) => RANK[Math.min(place, 4) - 1];
function rankXml(db, pl) {
  const m = me(db, pl), rows = ranking(db, pl.server_id, week());
  const mine = rows.findIndex((r) => r.uid === pl.uid) + 1;
  const list = rows.map((r, i) => `<item rank="${i + 1}" nick="${esc(r.nick)}" country="${r.country}" step_num="${r.steps}"/>`).join('');
  // the labels sit side by side under the icons, so they must stay short
  const names = ['1st', '2nd', '3rd', '4th-10th'];
  const rr = RANK.map(([id, icon, star], i) => `<item id="${id}" name="${names[i]}" icon="${icon}" star="${star}"/>`).join('');
  const sr = STEPS.map(([n, id, icon, star]) => `<item id="${id}" name="${n} steps" icon="${icon}" star="${star}"/>`).join('');
  return `<player>${el('rank', mine)}${el('step_num', m.steps)}</player>${el('limitscore', LIMIT)}<rank_list>${list}</rank_list>` +
    `<rank_reward_list>${rr}</rank_reward_list><step_reward_list>${sr}</step_reward_list>`;
}
// Cmd 1: rank reward for LAST week's ranking (top 10 with at least LIMIT steps). Cmd 2 AwardID 5-8: progress reward.
function receive(db, pl, cmd, awardId) {
  const m = me(db, pl);
  if (cmd === 2) {
    const i = awardId - 5, row = STEPS[i];
    if (!row) return { code: 3 };
    const got = m.claimed.split(',').filter(Boolean);
    if (got.includes(String(i))) return { code: 1 };
    if (m.steps < row[0]) return { code: 2 };
    db.prepare('UPDATE monopoly SET claimed=? WHERE uid=? AND server_id=? AND week=?').run(got.concat(i).join(','), pl.uid, pl.server_id, week());
    return { xml: `<reward_list>${game.grantDrop(db, pl, row[1])}</reward_list>` };
  }
  const last = week() - 1, rows = ranking(db, pl.server_id, last);
  const place = rows.findIndex((r) => r.uid === pl.uid) + 1;
  if (!place || place > 10 || rows[place - 1].steps < LIMIT) return { xml: el('limitcode', -1) };
  if (!db.prepare('INSERT OR IGNORE INTO monopoly_rank_claim VALUES(?,?,?)').run(pl.uid, pl.server_id, last).changes) return { xml: el('limitcode', -1) };
  return { xml: el('limitcode', -1) + `<reward_list>${game.grantDrop(db, pl, rankRow(place)[0])}</reward_list>` };
}

module.exports = { infoXml, roll, rankXml, receive };
