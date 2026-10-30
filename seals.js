// Tailed-beast seals (Plunder screen). Each seal (markmerge row) has up to 6 fragment ids (cols 3-8).
// Fragments are stored as props 20000+fragmentId. Plundering a fragment = a fight against a rival; a win
// usually takes the fragment. Synthesis turns one of each fragment into a seal card (cards.type 5, ninja_id = mark id).
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const FRAG = 20000;
const merges = () => game.table('markmerge').rows;
const fragIds = (row) => row.slice(3, 9).filter((x) => x > 0);

function listXml(db, pl) {
  const have = game.propCounts(db, pl.uid, pl.server_id);
  const chips = [];
  for (const row of merges()) for (const f of fragIds(row)) chips.push(`<chip>${el('id', f)}${el('count', have[FRAG + f] || 0)}</chip>`);
  const marks = merges().map((row) => `<mark>${el('id', row[0])}${el('resttime', 0)}</mark>`).join('');
  return `${el('cash', pl.gold)}<chiplist>${chips.join('')}</chiplist><markmerge>${marks}</markmerge>`;
}
function merge(db, pl, markId) {
  const row = merges().find((r) => r[0] === markId);
  if (!row) return { error: 'unknown seal' };
  const have = game.propCounts(db, pl.uid, pl.server_id);
  if (fragIds(row).some((f) => !(have[FRAG + f] > 0))) return { error: 'collect all fragments first' };
  for (const f of fragIds(row)) game.propAdd(db, pl.uid, pl.server_id, FRAG + f, -1);
  const seq = Number(db.prepare('INSERT INTO cards(uid,server_id,type,ninja_id) VALUES(?,?,5,?)').run(pl.uid, pl.server_id, markId).lastInsertRowid);
  return { xml: `<markchip bagid="${seq}"/>` };
}
// Plunder a fragment: win chance from team power vs the rival; on a win the fragment is taken.
function plunder(db, pl, fragId, win) {
  if (!merges().some((r) => fragIds(r).includes(fragId))) return false;
  if (win && Math.random() < 0.7) { game.propAdd(db, pl.uid, pl.server_id, FRAG + fragId, 1); return true; }
  return false;
}

module.exports = { listXml, merge, plunder, FRAG };
