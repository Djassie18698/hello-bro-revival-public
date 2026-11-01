// Treasure chests ("Whatever you want can be found", Event menu id 16 = boxOpenActivityView.lua) on rl_w_propuse:
// Cmd 1804 = info <propuse><item bdouble amount propid cashcost total opentimes/> x3 (gold, silver, bronze)</propuse>;
// Cmd 1803 Goodsid = open one chest with its key (prop 22 / 23 / 24) or, without a key, for cashcost gold:
// <propuse left golddouble silverdouble copperdouble cashcost>[<award>]</propuse>.
// ORIGINAL: the prize list of each chest is the client's own boxOpenInfoData.lua (shown with the Detail button), keys are items
// 22-24 and drop from fights ("Bronze Key" victory card, photo 2500); "chances today to open the treasure chest 75/75, VIP1 +5 times"
// (photos 2442, 3574). (ours): the weights, key prices in gold, gold chest opens a day = 25 + 5 x VIP, keys from story fights.
const game = require('./game');

// [prize, weight]; prize = { drop } (dropinfo id), { drop, n } (that drop n times), { gold }, { coin }, { prop, n } or 'double'
const CHESTS = [
  { prop: 22, gold: 50, items: [[{ gold: 1000 }, 1], [{ drop: 11 }, 2], [{ drop: 10 }, 3], [{ drop: 178 }, 8], [{ drop: 179 }, 8], [{ drop: 180 }, 8], [{ drop: 150 }, 8],
    [{ coin: 80000 }, 5], [{ coin: 20000 }, 14], [{ drop: 174, n: 5 }, 10], [{ prop: 4, n: 6 }, 12], [{ prop: 6, n: 10 }, 12], ['double', 7]] },
  { prop: 23, gold: 20, items: [[{ gold: 500 }, 1], [{ drop: 10 }, 2], [{ drop: 17 }, 4], [{ prop: 22, n: 1 }, 6], [{ drop: 181 }, 8], [{ drop: 182 }, 8], [{ drop: 183 }, 8], [{ drop: 20 }, 8],
    [{ coin: 30000 }, 8], [{ coin: 15000 }, 14], [{ drop: 174, n: 3 }, 10], [{ prop: 4, n: 3 }, 12], [{ prop: 6, n: 5 }, 12], ['double', 6]] },
  { prop: 24, gold: 5, items: [[{ gold: 100 }, 2], [{ prop: 23, n: 1 }, 10], [{ coin: 5000 }, 30], [{ prop: 3, n: 3 }, 25], [{ prop: 5, n: 3 }, 25], ['double', 8]] },
];

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS boxopen (uid INTEGER, server_id INTEGER, day TEXT, gold_opened INTEGER DEFAULT 0,
    d1 INTEGER DEFAULT 0, d2 INTEGER DEFAULT 0, d3 INTEGER DEFAULT 0, PRIMARY KEY(uid, server_id))`);
}
const today = () => new Date().toISOString().slice(0, 10);
function state(db, pl) {
  ensure(db);
  let r = db.prepare('SELECT * FROM boxopen WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (!r) { db.prepare('INSERT INTO boxopen(uid, server_id, day) VALUES (?,?,?)').run(pl.uid, pl.server_id, today()); r = { day: today(), gold_opened: 0, d1: 0, d2: 0, d3: 0 }; }
  if (r.day !== today()) { r.day = today(); r.gold_opened = 0; db.prepare('UPDATE boxopen SET day=?, gold_opened=0 WHERE uid=? AND server_id=?').run(r.day, pl.uid, pl.server_id); }
  return r;
}
const goldTotal = (db, pl) => 25 + 5 * require('./vip').level(db, pl.uid, pl.server_id);

function infoXml(db, pl) {
  const st = state(db, pl), have = game.propCounts(db, pl.uid, pl.server_id), total = goldTotal(db, pl);
  const items = CHESTS.map((c, i) => `<item bdouble="${st['d' + (i + 1)]}" amount="${have[c.prop] || 0}" propid="${c.prop}" cashcost="${c.gold}" total="${i === 0 ? total : 999}" opentimes="${i === 0 ? st.gold_opened : 0}"/>`).join('');
  return `<propuse>${items}</propuse>`;
}

function pick(items) {
  let x = Math.random() * items.reduce((t, [, w]) => t + w, 0);
  for (const [it, w] of items) if ((x -= w) < 0) return it;
  return items[items.length - 1][0];
}
// Pays one prize (twice when the chest's double flag is on) and returns the <award> XML.
function pay(db, pl, prize, times) {
  const awards = [];
  for (let k = 0; k < times; k++) {
    if (prize.drop) for (let j = 0; j < (prize.n || 1); j++) awards.push(game.grantDrop(db, pl, prize.drop));
    else if (prize.gold) { db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(prize.gold, pl.uid, pl.server_id); awards.push(game.awardFull({ cash: prize.gold })); }
    else if (prize.coin) { db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(prize.coin, pl.uid, pl.server_id); awards.push(game.awardFull({ coin: prize.coin })); }
    else if (prize.prop) {
      game.propAdd(db, pl.uid, pl.server_id, prize.prop, prize.n);
      awards.push(`<award dropid="1" coin="0"><cardlist></cardlist><proplist><prop><id>${prize.prop}</id><num>${prize.n}</num></prop></proplist><chipbag></chipbag><coin>0</coin><cash>0</cash><exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award>`);
    }
  }
  return game.mergeAwards(awards.filter(Boolean));
}

function open(db, pl, propId) {
  const i = CHESTS.findIndex((c) => c.prop === propId);
  if (i < 0) return { error: 'no such chest' };
  const c = CHESTS[i], st = state(db, pl);
  if (i === 0 && st.gold_opened >= goldTotal(db, pl)) return { error: 'no gold chest opens left today' };
  const keys = game.propCounts(db, pl.uid, pl.server_id)[c.prop] || 0;
  const cost = keys > 0 ? 0 : c.gold;
  if (pl.gold < cost) return { code: 10006 };
  if (cost) db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(cost, pl.uid, pl.server_id);
  else game.propAdd(db, pl.uid, pl.server_id, c.prop, -1);
  if (i === 0) { db.prepare('UPDATE boxopen SET gold_opened=gold_opened+1 WHERE uid=? AND server_id=?').run(pl.uid, pl.server_id); game.bumpTask(db, pl.uid, pl.server_id, 15); }
  const prize = pick(c.items), col = 'd' + (i + 1);
  let award = '';
  if (prize === 'double') db.prepare(`UPDATE boxopen SET ${col}=1 WHERE uid=? AND server_id=?`).run(pl.uid, pl.server_id); // the next prize of this chest counts twice
  else {
    award = pay(db, pl, prize, st[col] ? 2 : 1);
    db.prepare(`UPDATE boxopen SET ${col}=0 WHERE uid=? AND server_id=?`).run(pl.uid, pl.server_id);
  }
  const s2 = state(db, pl);
  return { xml: `<propuse left="${Math.max(0, keys - (cost ? 0 : 1))}" golddouble="${s2.d1}" silverdouble="${s2.d2}" copperdouble="${s2.d3}" cashcost="${cost}">${award}</propuse>` };
}

module.exports = { infoXml, open };
