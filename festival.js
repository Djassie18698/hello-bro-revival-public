// Festival trade event (home event button id 44, business_proxy/festival_business -> ui_festivalLayer, rl_x_small_activity):
// Cmd 9 = info + trade list, Cmd 10 = item shop, Cmd 11 ExId = trade; buying goes through rl_w_shopbuy Cmd 1700 Goodsid/Counts.
// The game's festival items are Christmas Cap (consumeinfo 38, "get in Training and Battles") and Christmas Tree (39, "get in Ninja
// Test and Spar"). The trade rewards use the game's own holiday drops: Santa of the Six Paths fragments (dropinfo 1852-1863, packs of
// 1/5/10/15) and Killer B (Santa Claus) fragments for Christmas, Kaguya for New Year fragments (1869-1883) for New Year.
// The Christmas trade list is the ORIGINAL one from the owner's Facebook group photos (FINDINGS.md "Holiday events", batch-03 0848/0858/0874):
// costs, rewards and limits (per event, not per day). Two prizes are cards this game version does not have (Kushina for New Year, Christmas
// Naruto), and the 5-fragment rows showed a Naruto card: those use the holiday cards this version has instead (ours). The New Year list,
// drop chances and the shop limit are (ours).
const game = require('./game');
const settings = require('./settings');

const CAP = 38, TREE = 39;
const THEMES = {
  christmas: {
    event: 'xmas', name: 'Merry Christmas',
    // [exchange id, caps, trees, limit per event, reward]; reward = { drop } (a dropinfo id) or { prop, n, show } (n of an item, `show` = a
    // dropinfo id of that item for the icon)
    trades: [
      [1, 30, 0, 30, { prop: 8, n: 15, show: 250 }],     // 15 Sage Stone III
      [2, 0, 25, 30, { drop: 108 }],                      // 10 Reincarnation Pills
      [3, 40, 30, 30, { prop: 34, n: 10, show: 1673 }],   // 10 Development Dan
      [4, 50, 40, 30, { drop: 1719 }],                    // 5 Souls Dan
      [5, 40, 40, 15, { drop: 1853 }],                    // 5 Santa of the Six Paths fragments (ATK)   (photo: a 5-star Naruto)
      [6, 40, 40, 15, { drop: 1857 }],                    // 5 Santa of the Six Paths fragments (DEF)
      [7, 100, 100, 1, { drop: 1127 }],                   // Sexy Technique (ninjutsu card)
      [8, 350, 350, 1, { drop: 1851 }],                   // Santa of the Six Paths (God)                (photo: Kushina for New Year)
      [9, 450, 400, 1, { drop: 1094 }],                   // Killer B (Santa Claus)                      (photo: Christmas Naruto)
    ],
  },
  newyear: {
    event: 'newyear', name: 'Happy New Year',
    trades: [
      [1, 30, 0, 30, { prop: 8, n: 15, show: 250 }],
      [2, 0, 25, 30, { drop: 108 }],
      [3, 40, 40, 15, { drop: 1871 }],                    // 5 Kaguya for New Year fragments (ATK)
      [4, 40, 40, 15, { drop: 1876 }],                    // 5 Kaguya for New Year fragments (DEF)
      [5, 100, 100, 3, { drop: 1881 }],                   // 5 Kaguya for New Year fragments (GOD)
      [6, 350, 350, 1, { drop: 1868 }],                   // Kaguya for New Year (God)
    ],
  },
};
const DROP = { chance: 0.6, max: 2 }; // (ours) per won fight: 60% chance of 1-2 items
const SHOP_PER_DAY = 10;              // (ours) each item can be bought 10 times a day, at the consumeinfo price (gold)

const day = () => new Date().toISOString().slice(0, 10);
const ensure = (db) => db.exec(`CREATE TABLE IF NOT EXISTS festival_use (uid INTEGER, server_id INTEGER, kind TEXT, id INTEGER, day TEXT, n INTEGER,
  PRIMARY KEY(uid, server_id, kind, id, day))`);
// trades count per event run (key = when the owner switched it on), shop buys per day
const period = (db, kind) => (kind === 'buy' ? day() : 'run' + (theme(db) ? settings.switchedOnAt(db, theme(db).event) : 0));
const used = (db, pl, kind, id) => (db.prepare('SELECT n FROM festival_use WHERE uid=? AND server_id=? AND kind=? AND id=? AND day=?').get(pl.uid, pl.server_id, kind, id, period(db, kind)) || { n: 0 }).n;
const use = (db, pl, kind, id) => db.prepare(`INSERT INTO festival_use VALUES(?,?,?,?,?,1)
  ON CONFLICT(uid, server_id, kind, id, day) DO UPDATE SET n=n+1`).run(pl.uid, pl.server_id, kind, id, period(db, kind));

// The running theme, or null (only one festival at a time: both use the same screen and items).
function theme(db) {
  for (const t of Object.values(THEMES)) if (settings.eventOn(db, t.event)) return t;
  return null;
}
const item = (id) => game.table('consumeinfo').rows.find((r) => r[1] === id) || [];

// Dates shown on the screen: from the day the owner switched the event on, two weeks of drops (moves along while it stays on).
function dates(db, t) {
  const on = settings.switchedOnAt(db, t.event) || Math.floor(Date.now() / 1000);
  const end = Math.max(on + 14 * 86400, Math.floor(Date.now() / 1000) + 86400);
  return { begin_drop: on, end_drop: end, begin_change: on, end_change: end, begin_buy: on, end_buy: end, del_time: end + 3 * 86400 };
}

// A won fight: training / battles drop caps, Ninja Test / spar drop trees. Returns the count added (0 when no festival runs).
function dropOnWin(db, pl, where) {
  if (!theme(db) || Math.random() >= DROP.chance) return 0;
  const n = 1 + Math.floor(Math.random() * DROP.max);
  game.propAdd(db, pl.uid, pl.server_id, where === 'training' ? CAP : TREE, n);
  return n;
}

function prop(id, quality, db, pl, d) {
  const r = item(id);
  return `<prop${id === CAP ? 'A' : 'B'}><prop_id>${id}</prop_id><prop_icon>${r[3]}</prop_icon><prop_num>${game.propCounts(db, pl.uid, pl.server_id)[id] || 0}</prop_num>` +
    `<prop_quality>${quality}</prop_quality>` + Object.entries(d).map(([k, v]) => `<${k}>${v}</${k}>`).join('') + `</prop${id === CAP ? 'A' : 'B'}>`;
}

function infoXml(db, pl) {
  const t = theme(db);
  if (!t) return null;
  ensure(db);
  const d = dates(db, t);
  const drops = game.table('dropinfo').rows;
  const rows = t.trades.map(([id, a, b, times, rw]) => {
    const drop = rw.drop || rw.show;
    const r = drops.find((x) => x[0] === drop) || [];
    // result icon: fragment = type 5 with the piece id, item = type 2 with the consumeinfo id, ninjutsu card = type 1, shinobi card = type 1
    const [type, goods, num] = rw.prop ? [2, rw.prop, rw.n] : r[8] ? [5, r[8], r[13]] : r[7] ? [2, r[7], r[13]] : r[5] ? [1, r[5], 1] : [1, r[3], r[13] || 1];
    return `<exchange exchange_id="${id}" remain_times="${Math.max(0, times - used(db, pl, 'ex', id))}" total_times="${times}">` +
      `<need><a_id>${a ? CAP : 0}</a_id><a_num>${a}</a_num><b_id>${b ? TREE : 0}</b_id><b_num>${b}</b_num></need>` +
      `<changed><a_id>${drop}</a_id><a_num>${num}</a_num><a_goods>${goods}</a_goods><a_type>${type}</a_type><b_id>0</b_id><b_num>0</b_num><b_goods>0</b_goods><b_type>0</b_type></changed>` +
      '</exchange>';
  }).join('');
  return `<activity><act_id>44</act_id><act_name>${t.name}</act_name>${prop(CAP, 4, db, pl, d)}${prop(TREE, 5, db, pl, d)}</activity><exchange_list>${rows}</exchange_list>`;
}

function trade(db, pl, exId) {
  const t = theme(db);
  if (!t) return { error: 'the festival is over' };
  ensure(db);
  const row = t.trades.find((x) => x[0] === exId);
  if (!row) return { error: 'no such trade' };
  const [, a, b, times, rw] = row;
  if (used(db, pl, 'ex', exId) >= times) return { error: 'no trades left for this event' };
  const have = game.propCounts(db, pl.uid, pl.server_id);
  if ((have[CAP] || 0) < a || (have[TREE] || 0) < b) return { error: 'not enough festival items' };
  if (a) game.propAdd(db, pl.uid, pl.server_id, CAP, -a);
  if (b) game.propAdd(db, pl.uid, pl.server_id, TREE, -b);
  use(db, pl, 'ex', exId);
  if (rw.prop) {
    game.propAdd(db, pl.uid, pl.server_id, rw.prop, rw.n);
    return { xml: require('./drops').awardXml({ cards: [], props: { [rw.prop]: rw.n }, coin: 0, cash: 0 }, rw.show) };
  }
  return { xml: game.grantDrop(db, pl, rw.drop) || game.awardFull({}) };
}

function shopXml(db, pl) {
  ensure(db);
  return '<prop_info>' + [CAP, TREE].map((id) => `<prop prop_id="${id}" prop_yuanbao="${item(id)[4] || 0}" prop_yinzi="0" prop_icon="${item(id)[3]}"` +
    ` total_times="${SHOP_PER_DAY}" remain_times="${Math.max(0, SHOP_PER_DAY - used(db, pl, 'buy', id))}"/>`).join('') + '</prop_info>';
}
const isItem = (id) => id === CAP || id === TREE;
function buy(db, pl, id) {
  if (!theme(db)) return { error: 'the festival is over' };
  ensure(db);
  if (used(db, pl, 'buy', id) >= SHOP_PER_DAY) return { error: 'no buys left today' };
  const price = item(id)[4] || 0;
  if (pl.gold < price) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(price, pl.uid, pl.server_id);
  game.propAdd(db, pl.uid, pl.server_id, id, 1);
  use(db, pl, 'buy', id);
  return { costG: price };
}

module.exports = { THEMES, theme, infoXml, trade, shopXml, buy, isItem, dropOnWin };
