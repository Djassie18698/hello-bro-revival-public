// "Starter stage gift" (ui_stageGiftLayer.lua, activity id 31): normally a paid bundle, here a free one-time claim.
// rl_r_newbie_pay Cmd 1 = info (remain_time, <item name description> of reward children, <payinfo status paymoney>),
// Cmd 2 = claim -> <award>. payinfo status: 1 = buy, 2 = claim, 3 = already claimed.
const drops = require('./drops');
const game = require('./game');
const GIFT = [1393, 1395, 1397, 1399]; // dropinfo: 10000 silver, 5 large ramen, 5 recruitment orders, 10 refresh orders

function ensure(db) { db.exec('CREATE TABLE IF NOT EXISTS stagegift (uid INTEGER, server_id INTEGER, PRIMARY KEY(uid,server_id))'); }
const claimed = (db, pl) => !!db.prepare('SELECT 1 FROM stagegift WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
const esc = (s) => String(s).replace(/[<>&"]/g, ' ');

function infoXml(db, pl) {
  ensure(db);
  const rows = game.table('dropinfo').rows;
  const items = GIFT.map((id) => { const r = rows.find((x) => x[0] === id); return `<gift dropid="${id}" icon="props_020" name="${esc(r ? r[2] : id)}"/>`; }).join('');
  return `<remain_time>${86400 * 3650}</remain_time><item name="Starter gift" description="A free welcome gift for every ninja">${items}</item>` +
    `<payinfo status="${claimed(db, pl) ? 3 : 2}" paymoney="0"/>`;
}

function claim(db, pl) {
  ensure(db);
  if (claimed(db, pl)) return { error: 'already claimed' };
  db.prepare('INSERT INTO stagegift(uid,server_id) VALUES(?,?)').run(pl.uid, pl.server_id);
  const out = drops.newOut();
  GIFT.forEach((id) => drops.give(db, pl, id, out));
  drops.settle(db, pl, out);
  return { xml: drops.awardXml(out) };
}

module.exports = { ensure, infoXml, claim };
