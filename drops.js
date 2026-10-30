// Resolve dropinfo rows (data/dropinfo.json) into player rewards and a client <award> element.
// dropinfo cols: 3 ninja id, 4 equipment id, 5 ninjutsu id, 6 seal id, 7 prop id, 8 fragment id, 10 gold, 11 silver, 13 count.
const game = require('./game');
const el = (n, v) => `<${n}>${v}</${n}>`;

const newOut = () => ({ props: {}, cards: [], coin: 0, cash: 0 });

function give(db, pl, dropId, out) {
  const d = game.table('dropinfo').rows.find((r) => r[0] === dropId);
  if (!d) return false;
  const n = Math.max(1, d[13] || 1);
  if (d[3] && game.ninjas().has(d[3])) for (let i = 0; i < n; i++) out.cards.push({ id: d[3], seq: game.giveCard(db, pl.uid, pl.server_id, d[3]), type: 1 });
  if (d[4]) for (let i = 0; i < n; i++) game.giveEquip(db, pl.uid, pl.server_id, d[4]); // gear is added silently (reveal dialog crashes for non-ninja)
  if (d[7]) { game.propAdd(db, pl.uid, pl.server_id, d[7], n); out.props[d[7]] = (out.props[d[7]] || 0) + n; }
  if (d[10]) out.cash += d[10] * n;
  if (d[11]) out.coin += d[11] * n;
  if (d[5] || d[6] || d[8]) out.coin += 20000 * n; // ninjutsu / seal / fragment: not implemented yet, paid out as silver
  return true;
}

// Apply the coin/cash part to the player row.
function settle(db, pl, out) {
  if (out.coin || out.cash) db.prepare('UPDATE players SET coin=coin+?, gold=gold+? WHERE uid=? AND server_id=?').run(out.coin, out.cash, pl.uid, pl.server_id);
}

function awardXml(out, dropId = 0) {
  const cards = out.cards.map((c) => `<card>${el('id', c.id)}${el('type', c.type)}${el('num', 1)}${el('attri', 0)}${el('bagIndex', c.seq)}</card>`).join('');
  const props = Object.entries(out.props).map(([id, num]) => `<prop>${el('id', id)}${el('num', num)}</prop>`).join('');
  return `<award dropid="${dropId}"><cardlist>${cards}</cardlist><proplist>${props}</proplist><chipbag></chipbag>` +
    `<coin>${out.coin}</coin><cash>${out.cash}</cash><exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award>`;
}

module.exports = { newOut, give, settle, awardXml };
