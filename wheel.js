// Lucky wheel (ui_rouletteLayer.lua). rl_r_wheel Cmd 1401 = load info + 12 wheel slots, rl_w_wheel Cmd 1400/1401 = spin once / ten times.
const game = require('./game');
const drops = require('./drops');
const el = (n, v) => `<${n}>${v}</${n}>`;
const COST = 50, SCORE = 10, JACKPOT_START = 5000;
const today = () => new Date().toISOString().slice(0, 10);

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS wheel (uid INTEGER, server_id INTEGER, score INTEGER DEFAULT 0, free_day TEXT DEFAULT "", jackpot INTEGER DEFAULT 0, PRIMARY KEY(uid,server_id))');
}
function state(db, pl) {
  ensure(db);
  let s = db.prepare('SELECT * FROM wheel WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (!s) { db.prepare('INSERT INTO wheel(uid,server_id,jackpot) VALUES(?,?,?)').run(pl.uid, pl.server_id, JACKPOT_START); s = { score: 0, free_day: '', jackpot: JACKPOT_START }; }
  return s;
}
const infoXml = (s, free) => `<info>${el('lasttime', 86400 * 3650)}${el('per_jifeng', SCORE)}${el('bigcash', s.jackpot)}${el('freetimes', free)}${el('jifeng', s.score)}${el('costsingle', COST)}</info>`;

function loadXml(db, pl) {
  const s = state(db, pl);
  const conf = game.table('wheelconfig').rows.map((r) => `<wheelitem id="${r[0]}" icon="${r[2]}" dropid="${r[4]}"></wheelitem>`).join('');
  return infoXml(s, s.free_day === today() ? 0 : 1) + `<wheelconf>${conf}</wheelconf>`;
}

function spin(db, pl, times) {
  const s = state(db, pl);
  const freeAvail = s.free_day !== today();
  const cost = (times - (freeAvail ? 1 : 0)) * COST;
  if (pl.gold < cost) return { error: 'not enough gold' };
  const rows = game.table('wheelconfig').rows;
  const total = rows.reduce((a, r) => a + r[5], 0);
  let jackpot = s.jackpot + Math.max(0, cost) / 2;
  const awards = [];
  for (let i = 0; i < times; i++) {
    let x = Math.random() * total, row = rows[rows.length - 1];
    for (const r of rows) { if ((x -= r[5]) < 0) { row = r; break; } }
    const out = drops.newOut();
    let dropId = row[4];
    if (!drops.give(db, pl, row[4], out)) { out.cash += jackpot; jackpot = JACKPOT_START; dropId = 0; } // "super prize" slot: pays the pot
    drops.settle(db, pl, out);
    awards.push(`<award_item item_id="${row[0]}">${drops.awardXml(out, dropId)}</award_item>`);
  }
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(Math.max(0, cost), pl.uid, pl.server_id);
  const score = s.score + SCORE * times;
  db.prepare('UPDATE wheel SET score=?, free_day=?, jackpot=? WHERE uid=? AND server_id=?').run(score, today(), jackpot, pl.uid, pl.server_id);
  return { xml: infoXml({ score, jackpot }, 0) + `<award_list>${awards.join('')}</award_list>` };
}

module.exports = { loadXml, spin };
