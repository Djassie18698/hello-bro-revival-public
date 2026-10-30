// Monthly sign-in (ui_monthSign.lua). rl_x_small_activity Cmd 7 = month list, Cmd 8 = sign (SignId).
// 28 slots per month (the client lays them out 4 per row). status: 0 can sign, 1 signed, 3 not reached yet.
const game = require('./game');
const drops = require('./drops');
const el = (n, v) => `<${n}>${v}</${n}>`;
// day -> [consumeinfo prop id, count]
const CYCLE = [[2, 1], [4, 2], [30, 2], [8, 10], [11, 1], [31, 3], [22, 1]];
const reward = (day) => { const [id, n] = CYCLE[(day - 1) % 7]; return [id, n * (1 + Math.floor((day - 1) / 14))]; };
const ym = () => new Date().toISOString().slice(0, 7);
const dayNow = () => Math.min(28, new Date().getUTCDate());

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS monthsign (uid INTEGER, server_id INTEGER, ym TEXT, day INTEGER, PRIMARY KEY(uid,server_id,ym,day))');
}
const signed = (db, pl) => new Set(db.prepare('SELECT day FROM monthsign WHERE uid=? AND server_id=? AND ym=?').all(pl.uid, pl.server_id, ym()).map((r) => r.day));

function listXml(db, pl) {
  ensure(db);
  const done = signed(db, pl), today = dayNow();
  const props = game.table('consumeinfo').rows;
  let items = '';
  for (let d = 1; d <= 28; d++) {
    const [pid, n] = reward(d);
    const icon = (props.find((r) => r[1] === pid) || [])[3] || 'props_020';
    const status = done.has(d) ? 1 : d <= today ? 0 : 3;
    items += `<signitem>${el('sign_id', d)}${el('need_vip', 0)}${el('award_id', pid)}${el('award_icon', icon)}${el('award_num', n)}${el('status', status)}</signitem>`;
  }
  return `<user>${el('days', done.size)}</user><month mth="${Number(ym().slice(5))}">${items}</month>`;
}

function sign(db, pl, signId) {
  ensure(db);
  if (!(signId >= 1 && signId <= dayNow())) return { error: 'not available yet' };
  if (signed(db, pl).has(signId)) return { error: 'already signed' };
  db.prepare('INSERT INTO monthsign(uid,server_id,ym,day) VALUES(?,?,?,?)').run(pl.uid, pl.server_id, ym(), signId);
  const [pid, n] = reward(signId);
  game.propAdd(db, pl.uid, pl.server_id, pid, n);
  const out = drops.newOut(); out.props[pid] = n;
  return { xml: drops.awardXml(out) };
}

module.exports = { listXml, sign };
