// Mora (rock-paper-scissors) minigame. res: 0 = lose, 1 = draw, 2 = win. Beat 4 NPCs in a row; 20 lives max.
const game = require('./game');
const NPCS = [
  { id: 1, icon: 'npc07_1', addexp: 10, text: 'Hmph, troublesome...', award: [{ folder: 'props', name: 'props_020', num: 1, dropid: 1 }] },
  { id: 2, icon: 'npc03_2', addexp: 20, text: 'Let us see what you got.', award: [{ folder: 'props', name: 'props_021', num: 1, dropid: 1 }] },
  { id: 3, icon: 'npc20_1', addexp: 30, text: 'Samehada is hungry.', award: [{ folder: 'props', name: 'props_016', num: 2, dropid: 1 }] },
  { id: 4, icon: 'npc17_4', addexp: 50, text: 'You cannot beat me.', award: [{ folder: 'props', name: 'props_021', num: 5, dropid: 1 }] },
];
const PACKS = [
  { id: 1, type: 1, need: 20, show: 'Silver chest: 20000 silver', coin: 20000 },
  { id: 2, type: 2, need: 100, show: 'Gold chest: 500 gold', cash: 500 },
];
function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS mora (uid INTEGER, server_id INTEGER, life INTEGER DEFAULT 20, pos INTEGER DEFAULT 1, npclife INTEGER DEFAULT 3, luck INTEGER DEFAULT 0, hist INTEGER DEFAULT 0, PRIMARY KEY(uid,server_id))');
}
function st(db, pl) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO mora(uid,server_id) VALUES(?,?)').run(pl.uid, pl.server_id);
  return db.prepare('SELECT * FROM mora WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
}
const el = (n, v) => `<${n}>${v}</${n}>`;
const awardAttrs = (a) => a.map((x) => `<award folder="${x.folder}" name="${x.name}" num="${x.num}" dropid="${x.dropid}"/>`).join('');
function myXml(m) {
  return `<my>${el('mylife', m.life)}${el('currluckypoint', m.luck)}${el('historylickypoint', m.hist)}${el('npcpos', m.pos)}${el('npclife', m.npclife)}${el('resttime', 86400)}${el('addone', 10)}${el('addall', 100)}${el('myrank', 1)}</my>`;
}
function infoXml(db, pl) {
  const m = st(db, pl);
  const npcs = NPCS.map((n) => `<npc>${el('id', n.id)}${el('icon', n.icon)}${el('addexp', n.addexp)}${el('gamble_show_text', n.text)}${el('gamble_mustwin', 20)}${awardAttrs(n.award)}</npc>`).join('');
  const awards = PACKS.map((p) => `<award>${el('gamble_id', p.id)}${el('gamble_type', p.type)}${el('gamble_need', p.need)}${el('gamble_drop_show', p.show)}</award>`).join('');
  const me = db.prepare('SELECT nick,country FROM players WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  const rank = `<rank>${el('rank', 1)}${el('country', me.country)}${el('nick', me.nick)}${el('score', m.hist)}</rank>`;
  return myXml(m) + `<info>1</info><npclist>${npcs}</npclist><awardlist>${awards}</awardlist>` + rank;
}
function play(db, pl, choice, mustWin) {
  const m = st(db, pl);
  if (m.life < 1) return { error: 'no lives left' };
  const cost = mustWin ? 20 : 0;
  if (pl.gold < cost) return { error: 'not enough gold' };
  if (cost) db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  const res = mustWin ? 2 : Math.floor(Math.random() * 3);
  let { life, pos, npclife, luck, hist } = m, award = '';
  if (res === 0) life--;
  if (res === 2) {
    luck += NPCS[pos - 1].addexp; hist += NPCS[pos - 1].addexp; npclife--;
    if (npclife <= 0) {
      const a = NPCS[pos - 1].award[0];
      game.propAdd(db, pl.uid, pl.server_id, 1, 0); // keeps table warm
      db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(a.num * 2000, pl.uid, pl.server_id);
      award = game.awardFull({ coin: a.num * 2000 });
      pos = pos % NPCS.length + 1; npclife = 3;
    }
  }
  db.prepare('UPDATE mora SET life=?,pos=?,npclife=?,luck=?,hist=? WHERE uid=? AND server_id=?').run(life, pos, npclife, luck, hist, pl.uid, pl.server_id);
  return { xml: `<preview>${el('mylife', life)}${el('npcpos', pos)}${el('npclife', npclife)}${el('currluckypoint', luck)}${el('historylickypoint', hist)}${el('res', res)}${el('addall', 100)}${el('totlecash', cost)}</preview>` + award };
}
function buyLife(db, pl, type) {
  const m = st(db, pl), cost = type === 2 ? 100 : 10, add = type === 2 ? 20 - m.life : 1;
  if (pl.gold < cost) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  db.prepare('UPDATE mora SET life=MIN(20,life+?) WHERE uid=? AND server_id=?').run(add, pl.uid, pl.server_id);
  return {};
}
function exchange(db, pl, id) {
  const m = st(db, pl), p = PACKS.find((x) => x.id === id);
  if (!p) return { error: 'bad pack' };
  if (m.luck < p.need) return { error: 'not enough luck' };
  db.prepare('UPDATE mora SET luck=luck-? WHERE uid=? AND server_id=?').run(p.need, pl.uid, pl.server_id);
  if (p.coin) db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(p.coin, pl.uid, pl.server_id);
  if (p.cash) db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(p.cash, pl.uid, pl.server_id);
  return { xml: game.awardFull({ coin: p.coin || 0, cash: p.cash || 0 }) };
}
module.exports = { infoXml, play, buyLife, exchange };
