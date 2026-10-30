// Ninja Treasure event (activity 24, ui_ninjaTreasureLayer.lua): a 3x3 board of dropinfo prizes. Each search
// (rl_w_sudoku Cmd 2) wins one random prize still on the board and costs more gold each time; Cmd 3 buys all the
// rest at once; Cmd 1 rerolls the board for gold. The board also rerolls by itself every few hours or once emptied.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const REFRESH_SECS = 4 * 3600, REFRESH_CASH = 20;
// single-item drops (dropinfo col 12 != 1): ninjas, fragments, ramen, gold, silver
const POOL = [28, 236, 221, 222, 69, 70, 33, 36, 38, 98, 99, 100, 42, 43];
const cost = (got) => 10 + 10 * got;
const now = () => Math.floor(Date.now() / 1000);

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS sudoku (uid INTEGER, server_id INTEGER, cells TEXT, made INTEGER, PRIMARY KEY(uid, server_id))');
}
function newBoard() {
  const ids = POOL.slice().sort(() => Math.random() - 0.5).slice(0, 9);
  return ids.map((id) => ({ id, got: 0 }));
}
function save(db, pl, cells, made) {
  db.prepare('INSERT OR REPLACE INTO sudoku VALUES(?,?,?,?)').run(pl.uid, pl.server_id, JSON.stringify(cells), made);
}
function board(db, pl, reroll) {
  ensure(db);
  const r = db.prepare('SELECT * FROM sudoku WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (r && !reroll && now() - r.made < REFRESH_SECS) {
    const cells = JSON.parse(r.cells);
    if (cells.some((c) => !c.got)) return { cells, made: r.made };
  }
  const b = { cells: newBoard(), made: now() };
  save(db, pl, b.cells, b.made);
  return b;
}
const num = (id) => { const r = game.table('dropinfo').rows.find((x) => x[0] === id); return r ? r[13] || 1 : 1; };
const gotCount = (cells) => cells.filter((c) => c.got).length;
const remainingCost = (cells) => { let g = gotCount(cells), t = 0; for (const c of cells) if (!c.got) t += cost(g++); return t; };
function costsXml(cells) {
  return el('refresh_cash', REFRESH_CASH) + el('lottery_cash', cost(gotCount(cells))) + el('total_cash', remainingCost(cells));
}
function infoXml(db, pl, reroll) {
  const b = board(db, pl, reroll);
  const midnight = 86400 - (now() % 86400);
  const cells = b.cells.map((c, i) => `<cell index="${i}" drop_id="${c.id}" got_award="${c.got}" drop_num="${num(c.id)}"/>`).join('');
  return '<basic>' + el('remain_time', 6 * 86400 + midnight) + el('refresh_time', Math.max(0, REFRESH_SECS - (now() - b.made))) + '</basic>' +
    costsXml(b.cells) + `<cell_info>${cells}</cell_info>`;
}
function spend(db, pl, gold) {
  const p = db.prepare('SELECT gold FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (!p || p.gold < gold) return false;
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(gold, pl.uid, pl.server_id);
  return true;
}
function refresh(db, pl) {
  if (!spend(db, pl, REFRESH_CASH)) return { error: 'not enough gold' };
  return { xml: infoXml(db, pl, true) };
}
function search(db, pl) {
  const b = board(db, pl);
  const left = b.cells.map((c, i) => (c.got ? -1 : i)).filter((i) => i >= 0);
  if (!left.length) return { error: 'board is empty' };
  if (!spend(db, pl, cost(gotCount(b.cells)))) return { error: 'not enough gold' };
  const idx = left[Math.floor(Math.random() * left.length)];
  b.cells[idx].got = 1;
  save(db, pl, b.cells, b.made);
  return { xml: '<basic>' + el('cell_index', idx) + '</basic>' + costsXml(b.cells) + game.grantDrop(db, pl, b.cells[idx].id) };
}
// One <award> holding every prize (the client reads only the first <award>).
function mergeAwards(list) {
  const pick = (re) => list.map((a) => (a.match(re) || ['', ''])[1]).join('');
  const sum = (tag) => list.reduce((s, a) => s + Number((a.match(new RegExp(`<${tag}>(\\d+)</${tag}>`)) || [0, 0])[1]), 0);
  const coin = sum('coin');
  return `<award dropid="${(list[0].match(/dropid="(\d+)"/) || [0, 1])[1]}" coin="${coin}"><cardlist>${pick(/<cardlist>(.*?)<\/cardlist>/)}</cardlist>` +
    `<proplist>${pick(/<proplist>(.*?)<\/proplist>/)}</proplist><chipbag></chipbag>${el('coin', coin)}${el('cash', sum('cash'))}` +
    '<exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award>';
}
function buyAll(db, pl) {
  const b = board(db, pl);
  const left = b.cells.filter((c) => !c.got);
  if (!left.length) return { error: 'board is empty' };
  if (!spend(db, pl, remainingCost(b.cells))) return { error: 'not enough gold' };
  const awards = left.map((c) => { c.got = 1; return game.grantDrop(db, pl, c.id); });
  save(db, pl, b.cells, b.made);
  return { xml: mergeAwards(awards) };
}

module.exports = { infoXml, refresh, search, buyAll };
