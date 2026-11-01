// Limited group purchase ("All-server limited group purchase gifts are waiting for you!", Event menu id 13,
// business_proxy/limitedGroupBuy_business -> ui_limitedGroupBuyingLayer): rl_r_comm Cmd 4 = list, rl_w_comm Cmd 8 LimitPackID = buy.
// The stock is shared by everyone on the server ("Left: 49").
// ORIGINAL (Facebook photos 1931, 2473, 2792, 3364, 3450, 3568): Super giftpacks with an original and a discount price: 100 Super Ninja
// Pills 3000 -> 1500, 300 Sage Stone III 3000 -> 2000, 80 Reincarnation Pills 4000 -> 2000, a pet (Kamatari) 500 -> 250, Pakkun 12 000
// -> 5500; "Left" 49-198. (ours): 5 Souls Dan as the 500 -> 250 pack (the pet packs are left out: this screen loads every icon from
// props/<icon>.plist and the game has no pet icon there), 50 of each per run, a run lasts 72 h from switching it on.
const game = require('./game');
const settings = require('./settings');

const RUN_HOURS = 72, STOCK = 50;
const PACKS = [ // [id, gold, original price, [[dropinfo id, name, icon]]]
  [1, 2000, 4000, [[122, 'Reincarnation Pill*80', 'props_033']]],
  [2, 2000, 3000, [[1424, '300*Sage Stone III', 'props_035']]],
  [3, 1500, 3000, [[936, 'Super Ninja Pills*100', 'props_145']]],
  [4, 250, 500, [[1719, 'Souls Dan*5', 'props_260']]],
];
const el = (k, v) => `<${k}>${v}</${k}>`;
const start = (db) => settings.switchedOnAt(db, 'groupbuy') || Math.floor(Date.now() / 1000);
const left = (db) => Math.max(0, start(db) + RUN_HOURS * 3600 - Math.floor(Date.now() / 1000));

function ensure(db) { db.exec('CREATE TABLE IF NOT EXISTS groupbuy (server_id INTEGER, run INTEGER, pack INTEGER, sold INTEGER, PRIMARY KEY(server_id, run, pack))'); }
function rest(db, pl, id) {
  ensure(db);
  const r = db.prepare('SELECT sold FROM groupbuy WHERE server_id=? AND run=? AND pack=?').get(pl.server_id, start(db), id);
  return Math.max(0, STOCK - (r ? r.sold : 0));
}

function listXml(db, pl) {
  if (!settings.eventOn(db, 'groupbuy')) return null;
  const items = PACKS.map(([id, cost, orig, awards]) => '<item>' + el('id', id) + el('cost', cost) + el('origincost', orig) + el('restnum', rest(db, pl, id)) +
    '<awardlist>' + awards.map(([drop, name, icon]) => '<award>' + el('name', name) + el('icon', icon) + el('dropid', drop) + el('newlife', 0) + '</award>').join('') + '</awardlist></item>').join('');
  return `<preview resttime="${left(db)}"/><itemlist>${items}</itemlist>`;
}

function buy(db, pl, id) {
  const p = PACKS.find((x) => x[0] === id);
  if (!p) return { error: 'no such pack' };
  if (!left(db)) return { error: 'the event is over' };
  if (rest(db, pl, id) <= 0) return { error: 'sold out' };
  if (pl.gold < p[1]) return { code: 10006 };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(p[1], pl.uid, pl.server_id);
  db.prepare('INSERT INTO groupbuy VALUES (?,?,?,1) ON CONFLICT(server_id, run, pack) DO UPDATE SET sold=sold+1').run(pl.server_id, start(db), id);
  const award = game.mergeAwards(p[3].map(([drop]) => game.grantDrop(db, pl, drop)).filter(Boolean));
  return { xml: `<preview restnum="${rest(db, pl, id)}"/>` + award };
}

module.exports = { listXml, buy };
