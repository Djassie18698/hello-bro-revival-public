// World boss ("xiao", fightBossView.lua): one boss per server per day that every player hits.
// Damage earns reputation (score), the killing blow and the damage ranking pay extra, reputation buys items.
const game = require('./game');

const el = (n, v) => `<${n}>${v}</${n}>`;
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = () => new Date().toISOString().slice(0, 10);
const BOSSES = [ // npc icon, name icon (props), attack type
  { icon: 'npc17_4', nameicon: 'props_115' }, { icon: 'npc20_1', nameicon: 'props_085' }, { icon: 'npc16_4', nameicon: 'props_100' },
];
const FIGHTS_PER_ROUND = 5, CD = 600, DICE_COST = 10, CD_COST = 20;
const SHOP = [ // reputation shop: [id, name, icon, cost, dropid]
  [1, 'Reincarnation Pill x5', 'props_049', 300, 107], [2, '500 Gold', 'props_073', 800, 371], [3, 'Five-Star Shinobi Card', 'props_015', 3000, 11],
];

function ensure(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS boss (server_id INTEGER, day TEXT, level INTEGER, hp INTEGER, maxhp INTEGER, killer TEXT DEFAULT '', PRIMARY KEY(server_id, day));
    CREATE TABLE IF NOT EXISTS boss_hits (server_id INTEGER, day TEXT, uid INTEGER, nick TEXT, dmg INTEGER DEFAULT 0, score INTEGER DEFAULT 0,
      fights INTEGER DEFAULT 0, last INTEGER DEFAULT 0, combo INTEGER DEFAULT 100, claimed INTEGER DEFAULT 0, PRIMARY KEY(server_id, day, uid));
    CREATE TABLE IF NOT EXISTS boss_log (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER, nick TEXT, val INTEGER, important INTEGER)`);
}
function boss(db, sid) {
  ensure(db);
  let b = db.prepare('SELECT * FROM boss WHERE server_id=? AND day=?').get(sid, day());
  if (!b) {
    const prev = db.prepare('SELECT level, hp FROM boss WHERE server_id=? ORDER BY day DESC LIMIT 1').get(sid);
    const level = prev ? (prev.hp <= 0 ? prev.level + 1 : Math.max(1, prev.level - 1)) : 1; // killed yesterday -> stronger
    const maxhp = 3000000 * level;
    db.prepare('INSERT INTO boss(server_id,day,level,hp,maxhp) VALUES(?,?,?,?,?)').run(sid, day(), level, maxhp, maxhp);
    b = db.prepare('SELECT * FROM boss WHERE server_id=? AND day=?').get(sid, day());
  }
  return b;
}
function me(db, pl) {
  ensure(db);
  db.prepare('INSERT OR IGNORE INTO boss_hits(server_id,day,uid,nick) VALUES(?,?,?,?)').run(pl.server_id, day(), pl.uid, pl.nick);
  return db.prepare('SELECT * FROM boss_hits WHERE server_id=? AND day=? AND uid=?').get(pl.server_id, day(), pl.uid);
}
function board(db, sid) { return db.prepare('SELECT * FROM boss_hits WHERE server_id=? AND day=? AND dmg>0 ORDER BY dmg DESC').all(sid, day()); }
function rankOf(db, pl) { return board(db, pl.server_id).findIndex((r) => r.uid === pl.uid) + 1; }
const rankAward = (rank) => (rank === 1 ? 1000 : rank <= 3 ? 600 : rank <= 10 ? 300 : rank > 0 ? 100 : 0);
function cdLeft(m) { return m.fights >= FIGHTS_PER_ROUND ? Math.max(0, m.last + CD - Math.floor(Date.now() / 1000)) : 0; }
function fightsLeft(m) { return cdLeft(m) > 0 ? 0 : FIGHTS_PER_ROUND - (m.fights % FIGHTS_PER_ROUND || (m.fights && cdLeft(m) === 0 ? 0 : 0)); }

function previewXml(db, pl, b, m) {
  const secsToMidnight = 86400 - (Math.floor(Date.now() / 1000) % 86400);
  return '<preview>' + el('resttime', secsToMidnight) + el('inact', b.hp > 0 ? 1 : 0) + el('lastattackman', esc(b.killer)) + el('lastaward', 500) +
    el('commwinaward', 20) + el('cost', DICE_COST) + el('commfailaward', 5) + el('level', b.level) + el('cdcost', CD_COST) + el('cdalltime', CD) +
    el('cdallnum', FIGHTS_PER_ROUND) + el('cashaddcost', 20) + el('cashaddonemin', 10) + el('cashaddonemax', 100) + el('coinaddcost', 20000) +
    el('coinaddonemin', 5) + el('coinaddonemax', 50) + el('index', 1) + el('commawardval', m.score) + el('rankawardval', rankAward(rankOf(db, pl))) +
    el('hurtawardval', 0) + el('commaward', m.claimed) + '</preview>';
}
function infoXml(db, pl) {
  const b = boss(db, pl.server_id), m = me(db, pl), look = BOSSES[(b.level - 1) % BOSSES.length];
  const left = cdLeft(m) > 0 ? 0 : FIGHTS_PER_ROUND - (m.fights % FIGHTS_PER_ROUND);
  return previewXml(db, pl, b, m) +
    '<user>' + el('combo', m.combo) + el('totlehurt', m.dmg) + el('score', m.score) + el('commawardval', m.score) + el('rankawardval', rankAward(rankOf(db, pl))) +
    el('coinadd', 0) + el('cashadd', 0) + el('cdresttime', cdLeft(m)) + el('cdrestnum', left) + el('rank', rankOf(db, pl)) + '</user>' +
    '<npc>' + el('restlife', Math.max(0, b.hp)) + el('totleblood', b.maxhp) + el('icon', look.icon) + el('nameicon', look.nameicon) + el('type', 1) + '</npc>' +
    '<exchange>' + SHOP.map(([id, name, icon, cost, dropid]) => `<item>${el('id', id)}${el('name', esc(name))}${el('icon', icon)}${el('cost', cost)}${el('dropid', dropid)}</item>`).join('') + '</exchange>' +
    '<rankhonner>' + [[1, 1000], [3, 600], [10, 300], [50, 100]].map(([r, v]) => `<item>${el('rank', r)}${el('val', v)}</item>`).join('') + '</rankhonner>' +
    '<damage><item>' + el('attack', 100000) + el('score', 20) + '</item><item>' + el('attack', 500000) + el('score', 50) + '</item></damage>';
}
function fight(db, pl) {
  const b = boss(db, pl.server_id), m = me(db, pl);
  if (b.hp <= 0) return { error: 'the boss is already defeated today' };
  if (cdLeft(m) > 0) return { error: 'resting, try again later' };
  const ts = game.teamStats(db, pl.uid, pl.server_id);
  const base = Math.round((ts.total.al + ts.total.ah) / 2);
  const dmg = Math.min(b.hp, Math.round(base * (20 + Math.random() * 10) * (m.combo / 100)));
  const hp = b.hp - dmg, killed = hp <= 0;
  const score = Math.max(5, Math.round(dmg / 5000)) + (killed ? 500 : 0);
  db.prepare('UPDATE boss SET hp=?, killer=CASE WHEN ? THEN ? ELSE killer END WHERE server_id=? AND day=?').run(hp, killed ? 1 : 0, pl.nick, pl.server_id, day());
  const fights = cdLeft(m) === 0 && m.fights >= FIGHTS_PER_ROUND ? 1 : m.fights + 1;
  db.prepare('UPDATE boss_hits SET dmg=dmg+?, score=score+?, fights=?, last=?, combo=100 WHERE server_id=? AND day=? AND uid=?')
    .run(dmg, score, fights, Math.floor(Date.now() / 1000), pl.server_id, day(), pl.uid);
  game.propAdd(db, pl.uid, pl.server_id, 9995, score); // boss reputation
  db.prepare('INSERT INTO boss_log(server_id,nick,val,important) VALUES(?,?,?,?)').run(pl.server_id, pl.nick, dmg, killed ? 1 : 0);
  const coin = 2000 + Math.round(dmg / 100);
  db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, pl.server_id);
  const look = BOSSES[(b.level - 1) % BOSSES.length];
  const fightXml = game.battleXml(db, pl, 1, 1, { enemyName: 'World Boss Lv.' + b.level, enemyLevel: 50 + b.level * 5 });
  return { xml: '<userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>' + fightXml + game.awardFull({ coin }) +
    '<xiao>' + el('restlife', Math.max(0, hp)) + el('award', score) + el('outputalltime', m.dmg + dmg) + '</xiao>', look };
}
function bossInfo(db, pl) {
  const b = boss(db, pl.server_id), m = me(db, pl);
  return el('restlife', Math.max(0, b.hp)) + el('totlehurt', m.dmg) + el('myrank', rankOf(db, pl));
}
function dice(db, pl) {
  if (pl.gold < DICE_COST) return { error: 'not enough gold' };
  const combo = 100 + 10 * (1 + Math.floor(Math.random() * 6)); // +10%..+60% damage on the next hit
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(DICE_COST, pl.uid, pl.server_id);
  me(db, pl);
  db.prepare('UPDATE boss_hits SET combo=? WHERE server_id=? AND day=? AND uid=?').run(combo, pl.server_id, day(), pl.uid);
  return { xml: `<result combo="${combo}"/>` };
}
function clearCd(db, pl) {
  if (pl.gold < CD_COST) return { error: 'not enough gold' };
  db.prepare('UPDATE players SET gold=gold-? WHERE uid=? AND server_id=?').run(CD_COST, pl.uid, pl.server_id);
  me(db, pl);
  db.prepare('UPDATE boss_hits SET fights=0 WHERE server_id=? AND day=? AND uid=?').run(pl.server_id, day(), pl.uid);
  return { xml: `<preview cost="${CD_COST}"/>` };
}
function exchange(db, pl, id) {
  const row = SHOP.find((r) => r[0] === id);
  if (!row) return { error: 'bad item' };
  const rep = game.propCounts(db, pl.uid, pl.server_id)[9995] || 0;
  if (rep < row[3]) return { error: 'not enough reputation' };
  game.propAdd(db, pl.uid, pl.server_id, 9995, -row[3]);
  return { xml: game.grantDrop(db, pl, row[4]) };
}
function heroXml(db, pl) {
  const b = boss(db, pl.server_id), m = me(db, pl);
  const country = (uid) => (db.prepare('SELECT country FROM players WHERE uid=? AND server_id=?').get(uid, pl.server_id) || { country: 1 }).country;
  const rows = (list) => list.slice(0, 20).map((r, i) => `<item>${el('rank', i + 1)}${el('country', country(r.uid))}${el('nick', esc(r.nick))}${el('score', r.dmg)}</item>`).join('');
  const prev = db.prepare('SELECT * FROM boss_hits WHERE server_id=? AND day<? AND dmg>0 ORDER BY day DESC, dmg DESC LIMIT 20').all(pl.server_id, day());
  return `<currrank my="${rankOf(db, pl)}">${rows(board(db, pl.server_id))}</currrank><hisrank>${rows(prev)}</hisrank>` + previewXml(db, pl, b, m);
}
function claim(db, pl) {
  const m = me(db, pl);
  if (m.claimed) return { error: 'already claimed' };
  const rank = rankAward(rankOf(db, pl));
  db.prepare('UPDATE boss_hits SET claimed=1 WHERE server_id=? AND day=? AND uid=?').run(pl.server_id, day(), pl.uid);
  game.propAdd(db, pl.uid, pl.server_id, 9995, rank);
  return { xml: `<award>${el('commawardval', 0)}${el('rankawardval', rank)}${el('hurtawardval', 0)}</award>` };
}
function msgs(db, pl, importantFrom, normalFrom) {
  ensure(db);
  const q = (imp, from) => db.prepare('SELECT * FROM boss_log WHERE server_id=? AND important=? AND id>? ORDER BY id DESC LIMIT 10').all(pl.server_id, imp, from || 0);
  const it = (r) => `<item id="${r.id}" nick="${esc(r.nick)}" val="${r.val}"/>`;
  return `<import_msg>${q(1, importantFrom).map(it).join('')}</import_msg><normal_msg>${q(0, normalFrom).map(it).join('')}</normal_msg>`;
}

module.exports = { infoXml, fight, bossInfo, dice, clearCd, exchange, heroXml, claim, msgs };
