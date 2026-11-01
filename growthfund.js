// Growth Fund ("Growth Plan", Event menu id 19, business_proxy/growthfund_b -> ui_growthfundLayer) on rl_x_small_activity:
// Cmd 1 = info, Cmd 2 = buy, Cmd 3 Id = claim one step. Reply <preview buycash multiple totalcash buystate needvip [cash]/> +
// <fundlist><item id level cash state/>...</fundlist>; state 0 = level not reached, 1 = claimable, 2 = claimed.
// ORIGINAL from the owner's Facebook group photo 2627: "Only insert 500 Gold, can get 5 feedback, total 2500 Gold (Only VIP3 and above
// buyers may purchase)", Lv.50 150 gold, Lv.70 150, Lv.90 200, then Lv.110 ... (cut off). The steps from Lv.110 on are (ours), chosen
// so that the total is the original 2500.
const PRICE = 500, MULTIPLE = 5, NEED_VIP = 3;
const STEPS = [[1, 50, 150], [2, 70, 150], [3, 90, 200], [4, 110, 200], [5, 130, 250], [6, 150, 250], [7, 170, 300], [8, 190, 300], [9, 210, 350], [10, 230, 350]];

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS growthfund (uid INTEGER, server_id INTEGER, bought INTEGER, PRIMARY KEY(uid, server_id));
    CREATE TABLE IF NOT EXISTS growthfund_claim (uid INTEGER, server_id INTEGER, step INTEGER, PRIMARY KEY(uid, server_id, step))`);
}
const bought = (db, pl) => !!db.prepare('SELECT 1 FROM growthfund WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
const claimed = (db, pl, id) => !!db.prepare('SELECT 1 FROM growthfund_claim WHERE uid=? AND server_id=? AND step=?').get(pl.uid, pl.server_id, id);

function xml(db, pl, extra = '') {
  ensure(db);
  const has = bought(db, pl);
  const list = STEPS.map(([id, level, cash]) =>
    `<item id="${id}" level="${level}" cash="${cash}" state="${claimed(db, pl, id) ? 2 : has && pl.level >= level ? 1 : 0}"/>`).join('');
  return `<preview buycash="${PRICE}" multiple="${MULTIPLE}" totalcash="${PRICE * MULTIPLE}" buystate="${has ? 1 : 0}" needvip="${NEED_VIP}"${extra}/><fundlist>${list}</fundlist>`;
}

function buy(db, pl, vipLevel) {
  ensure(db);
  if (bought(db, pl)) return { error: 'You have already purchased this item before' };
  if (vipLevel < NEED_VIP) return { error: `only VIP${NEED_VIP} and above` };
  if (pl.gold < PRICE) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(PRICE, pl.uid, pl.server_id);
  db.prepare('INSERT INTO growthfund VALUES (?,?,?)').run(pl.uid, pl.server_id, Math.floor(Date.now() / 1000));
  return { xml: xml(db, pl) };
}

function claim(db, pl, id) {
  ensure(db);
  const step = STEPS.find((s) => s[0] === id);
  if (!step) return { error: 'unknown step' };
  if (!bought(db, pl)) return { error: 'buy the growth plan first' };
  if (pl.level < step[1]) return { error: `reach level ${step[1]} first` };
  if (claimed(db, pl, id)) return { error: 'already claimed' };
  db.prepare('INSERT INTO growthfund_claim VALUES (?,?,?)').run(pl.uid, pl.server_id, id);
  db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(step[2], pl.uid, pl.server_id);
  return { xml: xml(db, pl, ` cash="${step[2]}"`) };
}

module.exports = { xml, buy, claim };
