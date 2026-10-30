// One handler per CGI. Each returns an XML string. Field names come from the client's own parser.
const crypto = require('crypto');
const game = require('./game');
const vip = require('./vip');
const wheel = require('./wheel');
const signin = require('./signin');
const guild = require('./guild');
const mora = require('./mora');
const slot = require('./slot');
const rankings = require('./rankings');
const boss = require('./boss');
const country = require('./country');
const war = require('./war');

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const el = (name, v) => `<${name}>${esc(v)}</${name}>`;

// Public host the client should use for the game servers (set HOST to your LAN IP / domain).
const publicHost = (ctx) => process.env.HOST || ctx.host || 'localhost:18080';

const servers = (ctx) => [
  { id: 1, name: 'Konoha', domain: `http://${publicHost(ctx)}`, busy: 1, para1: 1062, para2: 2, payzoneid: 1 },
];
const serverXml = (s, tag) =>
  `<${tag}>` + Object.entries(s).map(([k, v]) => el(k, v)).join('') + `</${tag}>`;

// Private server: any Uin/Session pair is accepted. Unknown accounts (e.g. the saved id from the
// original game servers) are created on the fly and keep the session the client sent.
// STRICT_SESSIONS=1 (public server): only rl_w_login2 may change an account's session; every other request
// must carry the session of the latest login, so a stale or copied session is refused.
function accountBySession(db, p, isLogin = false) {
  const uid = Number(p.Uin || p.Uid);
  if (!uid) return null;
  let acc = db.prepare('SELECT * FROM accounts WHERE uid=?').get(uid);
  if (!acc) {
    db.prepare('INSERT INTO accounts(uid,username,password,session) VALUES(?,?,?,?)').run(uid, 'guest' + uid, '', p.Session || '');
    acc = db.prepare('SELECT * FROM accounts WHERE uid=?').get(uid);
  } else if (process.env.STRICT_SESSIONS === '1' && !isLogin && p.Session !== acc.session) {
    return null;
  } else if (p.Session && acc.session !== p.Session) {
    db.prepare('UPDATE accounts SET session=? WHERE uid=?').run(p.Session, uid);
    acc.session = p.Session;
  }
  return acc;
}


// Training stage fight: always a win for now; rewards come from roundinfo (cols: 22 energy cost, 23 exp, 24 coins).
function trainingFight(db, pl, chap, stage) {
  const row = game.table('roundinfo').rows.find((r) => r[0] === stage) || [];
  const cost = row[22] || 3, exp = row[23] || 6, coin = row[24] || 15;
  const lv = game.addExp(db, pl, exp);
  db.prepare('UPDATE players SET coin=coin+?, energy=MAX(0,energy-?) WHERE uid=? AND server_id=?').run(coin, cost, pl.uid, pl.server_id);
  game.setStage(db, pl.uid, pl.server_id, chap, stage + 1);
  game.bumpTask(db, pl.uid, pl.server_id, 1); game.bumpTask(db, pl.uid, pl.server_id, 2);
  const energy = Math.max(0, pl.energy - cost);
  const attrs = `curchapter="${chap}" curstage="${stage + 1}" pos="1" pos_time="0" pk_boss_times="0" curaction="${energy}" LastActionUpdatePastTime="0"`;
  return `<root code="0"><pve ${attrs}/><userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>` + game.battleXml(db, pl, chap, stage) +
    game.awardFull({ coin, exp }) + '</root>';
}

const MT = { perday: 50, low: 1, top: 5, cost: 20, free: 5, start: 5000 };
function mtree(db, p, shake) {
  const acc = accountBySession(db, p);
  const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
  if (!pl) return '<root code="3"><message>session expired</message></root>';
  db.exec('CREATE TABLE IF NOT EXISTS mtree (uid INTEGER, server_id INTEGER, day TEXT, used INTEGER DEFAULT 0, last INTEGER DEFAULT 0, PRIMARY KEY(uid,server_id))');
  const day = new Date().toISOString().slice(0, 10);
  let m = db.prepare('SELECT * FROM mtree WHERE uid=? AND server_id=?').get(pl.uid, pl.server_id);
  if (!m) { db.prepare('INSERT INTO mtree(uid,server_id,day) VALUES(?,?,?)').run(pl.uid, pl.server_id, day); m = { day, used: 0, last: 0 }; }
  if (m.day !== day) { m.day = day; m.used = 0; }
  const free = Math.max(0, MT.free - m.used);
  if (!shake) return `<root code="0"><cf><timesperday>${MT.perday}</timesperday><low_multiple>${MT.low}</low_multiple><top_multiple>${MT.top}</top_multiple><shake_cost>${MT.cost}</shake_cost><free_shake>${MT.free}</free_shake><start_silver>${MT.start}</start_silver></cf><user><usedTimes>${m.used}</usedTimes><freeTimes>${free}</freeTimes><latestSilver>${m.last}</latestSilver><latestTimest>${Math.floor(Date.now() / 1000)}</latestTimest></user></root>`;
  if (m.used >= MT.perday) return '<root code="5"><message>no shakes left today</message></root>';
  const cost = free > 0 ? 0 : MT.cost;
  if (pl.gold < cost) return '<root code="5"><message>not enough gold</message></root>';
  const win = MT.start * (MT.low + Math.floor(Math.random() * (MT.top - MT.low + 1)));
  db.prepare('UPDATE players SET gold=gold-?, coin=coin+? WHERE uid=? AND server_id=?').run(cost, win, pl.uid, pl.server_id);
  game.bumpTask(db, pl.uid, pl.server_id, 17);
  db.prepare('UPDATE mtree SET day=?, used=?, last=? WHERE uid=? AND server_id=?').run(day, m.used + 1, win, pl.uid, pl.server_id);
  return `<root code="0"><user><usedTimes>${m.used + 1}</usedTimes><freeTimes>${Math.max(0, free - 1)}</freeTimes><latestSilver>${win}</latestSilver><cash>${pl.gold - cost}</cash><coin>${pl.coin + win}</coin></user></root>`;
}

const TOPUPS = [ // the original Google Play packages (rmb = price in cents)
  { id: 3, rmb: 99, gold: 45, give: 0 }, { id: 4, rmb: 499, gold: 240, give: 10 }, { id: 5, rmb: 999, gold: 490, give: 30 },
  { id: 6, rmb: 1999, gold: 1050, give: 80 }, { id: 7, rmb: 4999, gold: 2700, give: 300 }, { id: 8, rmb: 9999, gold: 5500, give: 800 },
];

// Tower sweep counter: one progress row per day (stage = uses + 1; setStage keeps the max).
const SWEEP_DAILY = 5;
const sweepKey = () => 100000 + Math.floor(Date.now() / 86400000);
const sweepsUsed = (db, uid, sid) => game.getStage(db, uid, sid, sweepKey()) - 1;

module.exports = {
  // Server directory: server list + notices
  xk_r_dir: (ctx) =>
    `<root code="0"><way val="0"><val>0</val></way><noticeurl url=""/>` +
    `<serverlist>${servers(ctx).map((s) => serverXml(s, 'server')).join('')}</serverlist>` +
    `<noticelist><notice><id>1</id><display>1</display><title>Hello Bro is back!</title>` +
    `<content>Welcome back, ninja. Private revival server.</content></notice></noticelist></root>`,

  xk_w_dir: (ctx) => module.exports.xk_r_dir(ctx),

  // Account login. Unknown accounts are auto-created (like the old test servers).
  xk_w_login: ({ db, params: p, host, cgi, ...rest }) => {
    const name = (p.UserName || p.Machine || p.MachineCheck || `guest${Date.now()}`) + (process.env.HB_TEST_SUFFIX || '');
    const pwd = p.Password || '';
    let acc = db.prepare('SELECT * FROM accounts WHERE username=?').get(name);
    if (!acc) {
      db.prepare('INSERT INTO accounts(username,password) VALUES(?,?)').run(name, pwd);
      acc = db.prepare('SELECT * FROM accounts WHERE username=?').get(name);
    } else if (pwd && acc.password && acc.password !== pwd) {
      return '<root code="2"><message>wrong password</message></root>';
    }
    const session = crypto.randomBytes(16).toString('hex').toUpperCase();
    db.prepare('UPDATE accounts SET session=? WHERE uid=?').run(session, acc.uid);
    return (
      `<root code="0"><login_info>${el('userid', acc.uid)}${el('session', session)}${el('username', acc.username)}</login_info>` +
      `<svrlist>${servers({ host }).map((s) => serverXml(s, 'svr')).join('')}</svrlist></root>`
    );
  },

  xk_w_reg: (ctx) => module.exports.xk_w_login(ctx),

  // Version / update check: nothing to update.
  rl_r_version: (ctx) => {
    // Hot update: cdn/manifest.json = { "val": "x.y.z", "files": [{ name, val, md5, size }] }. Without a manifest the
    // version is far below the client's, so it never downloads anything.
    let man = { val: '0.0.1', files: [] };
    try { man = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'cdn', 'manifest.json'), 'utf8')); } catch (e) { /* no updates */ }
    const files = man.files.map((f) => `<file name="${f.name}" val="${f.val}" md5="${f.md5}" size="${f.size}" ignor="0" force="0"/>`).join('');
    const cdn = `<cdn>http://${publicHost(ctx)}/cdn/</cdn>`;
    // Both blocks have the children <version val/>, <cdn>, <filelist><file .../></filelist> directly under them.
    // <updateversion> = APK updater (Java, would download a whole APK): kept below the client so it never fires.
    // <updatechip> = in-game resource updater (CDialogUpdateProgressView): carries our hot-update zips.
    return '<root code="0"><updateversion><version val="0.0.1"/>' + cdn + '<filelist></filelist><force>0</force><notice><content></content></notice></updateversion>' +
      `<updatechip><version val="${man.val}"/>${cdn}<filelist>${files}</filelist><ptfilelist></ptfilelist></updatechip></root>`;
  },

  // Activity / event badges (Lua side). Nothing running.
  rl_r_trackpoint: () => '<root code="0"><activity></activity><display>0</display></root>',

  // Client device report (analytics) - accept and ignore.
  rl_w_report: () => '<root code="0"></root>',

  // Enter a game server. hasreg=0 sends the client to character creation.
  rl_w_login2: ({ db, params: p }) => {
    const acc = accountBySession(db, p, true);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const pl = db.prepare('SELECT 1 FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return (
      `<root code="0"><login_info>${el('hasreg', pl ? 1 : 0)}${el('userid', acc.uid)}${el('session', acc.session)}</login_info>` +
      `${el('first_login', pl ? 0 : 1)}</root>`
    );
  },

  rl_r_randname: () => `<root code="0"><randname>${el('name', 'Ninja' + Math.floor(Math.random() * 99999))}</randname></root>`,

  // Create a character.
  rl_w_reg2: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const sid = Number(p.ServerID || 1);
    db.prepare(
      'INSERT OR IGNORE INTO players(uid,server_id,nick,country,card,created) VALUES(?,?,?,?,?,?)'
    ).run(acc.uid, sid, p.Nick || `Ninja${acc.uid}`, Number(p.Country || 1), Number(p.Card || 1), Date.now());
    game.ensureStarterTeam(db, acc.uid, sid, Number(p.Card || 1));
    return `<root code="0"><login_info>${el('userid', acc.uid)}${el('session', acc.session)}</login_info></root>`;
  },

  // Main page / initial player data. Field names are the ones CPlayerDataMgr reads from <user>.
  rl_r_mainpage: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const pl = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="4"><message>no character</message></root>';
    game.ensureStarterTeam(db, acc.uid, pl.server_id, 1);
    // Offline server: energy is refilled to the level's maximum on every login.
    const lvRow = game.table('playerlevel').rows.find((r) => r[1] === pl.level);
    if (lvRow && pl.energy < lvRow[4]) { db.prepare('UPDATE players SET energy=? WHERE uid=? AND server_id=?').run(lvRow[4], pl.uid, pl.server_id); pl.energy = lvRow[4]; }
    const gs = game.stateXml(db, acc.uid, pl.server_id);
    const f = { uid: acc.uid, nick: pl.nick, cash: pl.gold, coin: pl.coin, curaction: pl.energy, cursp: 10,
      level: pl.level, country: pl.country, maxteammember: 5, activeTeamId: 0,
      attactlow: gs.totals.al, attacthigh: gs.totals.ah, defenselow: gs.totals.dl, defensehigh: gs.totals.dh, chakralow: gs.totals.cl, chakrahigh: gs.totals.ch,
      caneat: 0, meritlevel: 0, meritscore: game.propCounts(db, acc.uid, pl.server_id)[9994] || 0, warpower: 0, LastActionUpdatePastTime: 0, LastSPUpdatePastTime: 0,
      score: 0, viplevel: vip.level(db, acc.uid, pl.server_id), soul: 0, totalm: 0 };
    return '<root code="0"><user>' + Object.entries(f).map(([k, v]) => el(k, v)).join('') + '</user>' + gs.cards +
      gs.suitlist + '<defensesuitlist></defensesuitlist><chipbag></chipbag>' +
      gs.ninjalist + '<defenseninjalist></defenseninjalist>' +
      '<chapinfo currentchap="19" currentstage="1"/></root>';
  },

  // Gacha status (free pulls / pity counters). Everything available, nothing to track yet.
  rl_r_recruit: () => '<root code="0"><recruit protect_comming="0" ninjaid="0" cost="0" bagid="0" attr="0"/></root>',

  // Gacha pull. Cmd 1901 = ten-pull, otherwise a single pull. Type = recruitinfo row (1 premium, 2 standard, 3 free).
  rl_w_recruit: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const pl = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="4"><message>no character</message></root>';
    const count = Number(p.Cmd) === 1901 ? 10 : 1;
    const res = game.pull(db, pl, Number(p.Type || 2), count, Number(p.Free) === 1);
    if (res.error) return '<root code="5"><message>' + res.error + '</message></root>';
    return '<root code="0">' + game.pullXml(res, count) + '</root>';
  },

  // Spar / Plunder opponent lists.
  rl_r_pk: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const pl = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return '<root code="0">' + game.rivalsXml(db, pl) + '</root>';
  },

  // Spar fight against a rival (Cmd 2701, ToUid).
  rl_w_pvp: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const pl = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    const r = game.sparFight(db, pl, Number(p.ToUid));
    game.addExp(db, pl, r.exp);
    db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(r.coin, pl.uid, pl.server_id);
    if (r.win) { game.bumpTask(db, pl.uid, pl.server_id, 6); }
    return '<root code="0"><userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>' + r.xml + game.awardFull({ coin: r.coin, exp: r.exp }) + '</root>';
  },

  // Plunder / seal list (no seals yet) and country war status (no war running).
  rl_r_markchip: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT gold FROM players WHERE uid=?').get(acc.uid);
    return `<root code="0"><cash>${pl ? pl.gold : 0}</cash><chiplist></chiplist><markmerge></markmerge></root>`;
  },
  // Country war (War > War tab). Cmd 7200 status (also polled from home), 7300ish war info.
  rl_r_warnew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + war.infoXml(db, pl) + '<display>0</display></root>';
  },
  // 4102 attack, 4101 revive (buy lives), 4103 auto attack, 4104 clear cd.
  rl_w_warnew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd);
    const r = cmd === 4102 ? war.attack(db, pl) : cmd === 4101 ? war.revive(db, pl) : cmd === 4100 ? war.exchange(db, pl, Number(p.PackID)) : { xml: '<preview cost_cash="0"/>' };
    return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>';
  },
  rl_r_warresultnew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return pl ? '<root code="0">' + war.resultXml(db, pl) + '</root>' : '<root code="3"><message>session expired</message></root>';
  },
  rl_r_warmsgnew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return pl ? '<root code="0">' + war.msgXml(db, pl, Number(p.Cmd) === 7701) + '</root>' : '<root code="3"><message>session expired</message></root>';
  },
  rl_w_warresultnew: () => '<root code="0"></root>',
  // Country officials (War > Country tab): Cmd 7100 seat list + salary state.
  rl_r_countrynew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return pl ? '<root code="0">' + country.infoXml(db, pl) + '</root>' : '<root code="3"><message>session expired</message></root>';
  },
  rl_r_countryranknew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return pl ? '<root code="0">' + country.rankXml(db, pl, Number(p.Cmd), Number(p.Country) || 0) + '</root>' : '<root code="3"><message>session expired</message></root>';
  },
  // Cmd 4002 Offical=<seat> take/challenge a seat, Cmd 4003 collect the official's daily salary.
  rl_w_countrynew: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = Number(p.Cmd) === 4003 ? country.salary(db, pl) : country.take(db, pl, Number(p.Offical));
    return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>';
  },

  // Mailbox / notices (nothing yet), scrolling bulletin, activity list (no events), lucky wheel info.
  // Mailbox: Cmd 1802 = system notices (a welcome message), 1800 fights / 1801 friends stay empty.
  // Mailbox (Cmd 1802): welcome note + messages other players sent with the friend "Communicate" button (rl_w_friend Msg).
  rl_r_msg: ({ db, params: p }) => {
    if (Number(p.Cmd) !== 1802) return '<root code="0"><msglist></msglist></root>';
    const now = Math.floor(Date.now() / 1000);
    const acc = accountBySession(db, p);
    db.exec('CREATE TABLE IF NOT EXISTS mail (id INTEGER PRIMARY KEY AUTOINCREMENT, to_uid INTEGER, from_nick TEXT, text TEXT, ts INTEGER)');
    const mails = acc ? db.prepare('SELECT * FROM mail WHERE to_uid=? ORDER BY id DESC LIMIT 50').all(acc.uid) : [];
    const items = mails.map((m) => `<msg><iTime>${m.ts}</iTime><ID>${m.id + 1}</ID><iStatus>1</iStatus><text>${esc(m.from_nick + ': ' + m.text)}</text></msg>`).join('');
    return `<root code="0"><msglist>${items}<msg><iTime>${now}</iTime><ID>1</ID><iStatus>1</iStatus><text>Welcome back to Hello Bro! Revival server.</text></msg></msglist></root>`;
  },
  rl_r_bulletin: () => {
    const now = Math.floor(Date.now() / 1000);
    return `<root code="0"><servertime>${now}</servertime><bulletinlist><bulletin><id>1</id><type>1</type><cycle>60</cycle><begintime>${now - 86400}</begintime><endtime>${now + 86400 * 3650}</endtime><content>Welcome back to Hello Bro! Offline revival server - have fun with your friends.</content></bulletin></bulletinlist></root>`;
  },
  rl_r_activity: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + game.actXml(db, pl) + '</root>';
  },
  rl_w_activity: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = game.actClaim(db, pl, Number(p.ActID), Number(p.SubID));
    if (!r) return '<root code="5"><message>not available</message></root>';
    return '<root code="0">' + game.awardFull(r) + '</root>';
  },
  // Small activities (month sign-in is Cmd 7/8; others not built yet -> empty OK reply).
  rl_x_small_activity: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd);
    if (cmd === 7) return '<root code="0">' + signin.listXml(db, pl) + '</root>';
    if (cmd === 8) {
      const r = signin.sign(db, pl, Number(p.SignId));
      return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>';
    }
    return '<root code="0"></root>';
  },
  rl_r_wheel: ({ db, params: p }) => {
    if (Number(p.Cmd) !== 1401) return '<root code="0"><info><bigcash>0</bigcash><jifeng>0</jifeng><lasttime>0</lasttime><per_jifeng>0</per_jifeng></info><award_list></award_list></root>';
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + wheel.loadXml(db, pl) + '</root>';
  },
  rl_w_wheel: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = wheel.spin(db, pl, Number(p.Cmd) === 1401 ? 10 : 1);
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return '<root code="0">' + r.xml + '</root>';
  },

  // Misc event-center screens with no content yet.
  rl_x_award_msg: () => '<root code="0"><expiry>7</expiry><msglist></msglist></root>',
  // VIP gift shop (VipListView.lua) and free top-up reward.
  rl_r_vipshop: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + vip.listXml(db, pl) + '</root>';
  },
  rl_w_vipshopbuy: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = vip.buy(db, pl, Number(p.GiftId));
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return '<root code="0">' + r.xml + '</root>';
  },
  rl_w_paypack: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + game.awardFull({}) + '</root>';
  },
  // Top-up screen header (VIP bar) + first-recharge gift state. Everyone is VIP on this server.
  rl_r_paypack: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const lv = acc ? vip.level(db, acc.uid, Number(p.ServerID || 1)) : 0;
    return `<root code="0"><payheaplist></payheaplist><maxlv>${vip.MAX_VIP}</maxlv><exp>${lv * 1000}</exp><lvexp>${(lv + 1) * 1000}</lvexp>` +
      '<canget>1</canget><first_pay>1</first_pay><multiple>1</multiple><servertime>0</servertime><endtime>0</endtime></root>';
  },
  // Top-up packages. Buying is FREE here (the hot-updated ui_purchaseLayer.lua calls rl_x_free_topup instead of Google Play).
  rl_r_readconf: () => '<root code="0"><payact><mul>1</mul><bOpen>0</bOpen></payact><rechargelist>' +
    TOPUPS.map((t) => `<item><recharge_id>${t.id}</recharge_id><recharge_rmb>${t.rmb}</recharge_rmb><recharge_yuanbao>${t.gold}</recharge_yuanbao><recharge_yuanbao_give>${t.give}</recharge_yuanbao_give></item>`).join('') +
    '</rechargelist></root>',
  // Native top-up button: the client asks for a Google Play order. We grant the gold right away and answer code 1
  // ("Successfully purchased"), so the client never opens Google Play. Gold shows after the next screen refresh.
  rl_w_ky_payorder: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const t = TOPUPS.find((x) => x.id === Number(p.ItemId));
    if (acc && t) db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(t.gold + t.give, acc.uid, Number(p.ServerID || 1));
    return '<root code="1"></root>';
  },
  rl_x_free_topup: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const t = TOPUPS.find((x) => x.id === Number(p.RechargeId));
    if (!t) return '<root code="5"><message>bad package</message></root>';
    db.prepare('UPDATE players SET gold=gold+? WHERE uid=? AND server_id=?').run(t.gold + t.give, pl.uid, pl.server_id);
    return '<root code="0">' + game.awardFull({ cash: t.gold + t.give }) + '</root>';
  },
  // Hall of fame: all real players ranked by level.
  rl_r_ninja_rank: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const all = db.prepare('SELECT uid,nick,country,level FROM players ORDER BY level DESC, uid').all();
    const me = all.findIndex((r) => acc && r.uid === acc.uid) + 1;
    const items = all.map((r, i) => `<item rank="${i + 1}" uid="${r.uid}" nick="${String(r.nick).replace(/[<>&"]/g, '')}" country="${r.country}" level="${r.level}" min_score="${r.level * 10}" max_score="${r.level * 20}"/>`).join('');
    return `<root code="0"><player><rank>${me || 1}</rank><min_score>10</min_score><max_score>20</max_score></player><rank_list>${items}</rank_list></root>`;
  },

  // Eight Gates (Dun): Cmd 1 = info, Cmd 2 = open the next gate.
  rl_w_eight_gate: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 2) {
      const r = game.gateOpen(db, pl);
      if (r.error) return `<root code="${r.code || 5}"><message>${r.error}</message></root>`;
      pl.coin -= 0;
    }
    const fresh = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, pl.server_id);
    return '<root code="0">' + game.gateXml(db, fresh) + '</root>';
  },

  // Shop purchase of a consumable (Goodsid, Count).
  rl_w_shopbuy: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 1701) {
      const r = game.packBuy(db, pl, Number(p.Packageid));
      if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
      if (r.type !== 1) return `<root code="0"><shopbuy costyb="${r.costG}" costyz="${r.costS}"></shopbuy></root>`; // equipment: client crashes on the reveal dialog; cards show up after re-login
      return `<root code="0"><shopbuy costyb="${r.costG}" costyz="${r.costS}"><retobj type="${r.type}" id="${r.ninja}" count="${r.n}" bagid="${r.seq}" attr="${r.attrs}"/></shopbuy></root>`;
    }
    const cnt = Math.max(1, Math.min(999, Number(p.Count) || 1));
    const r = game.shopBuy(db, pl, Number(p.Goodsid), cnt);
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return `<root code="0"><shopbuy costyb="${r.costG}" costyz="${r.costS}"><retobj type="2" id="${Number(p.Goodsid)}" count="${cnt}"/></shopbuy></root>`;
  },

  rl_w_propuse: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = game.propUse(db, pl, Number(p.Goodsid));
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return `<root code="0"><propuse ap="${r.ap}" sp="0" yinzi="${r.coin}" left="${r.left}" rest="0" max="0"/></root>`;
  },

  rl_w_strengthen: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const eat = String(p.EATCardsBagIDList || '').split('|').map(Number).filter(Boolean);
    const r = game.strengthen(db, pl, Number(p.SRCBagID), eat);
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return `<root code="0" eatexp="${r.exp}"></root>`;
  },

  // Team editing: Cmd 2301.. = equip card NewID into slot Seq (kind = Cmd - 2300).
  rl_w_ninjalist: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const kind = Number(p.Cmd) - 2300;
    if (kind >= 1 && kind <= 8) game.equip(db, pl, Number(p.Seq), kind, Number(p.NewID) || 0);
    const gs = game.stateXml(db, pl.uid, pl.server_id);
    return `<root code="0"><teamid>${Number(p.TeamId) || 0}</teamid>${gs.suitlist}${gs.ninjalist}</root>`;
  },

  // Secret (soul) shop: Cmd 1 list, 2 refresh, 4 buy (Soul=row id), 5 soul value of cards.
  rl_x_mystery_shop: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd);
    if (cmd === 4) {
      const r = game.secretBuy(db, pl, Number(p.Soul));
      if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
      return '<root code="0">' + game.awardXml({ ninja: r.ninja, seq: r.seq }) + '</root>';
    }
    if (cmd === 5) return '<root code="0"><total_val>0</total_val><card_list></card_list></root>';
    return '<root code="0">' + game.secretXml(db, pl) + '</root>';
  },

  // Akatsuki (guild): see guild.js. Cmd 1/5 list, 2 detail, 3 create, 6 apply (instant join), 7 create cost, 8 entry check, 9 buildings, 10 quit.
  rl_r_group_comm: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd), bad = (m) => `<root code="5"><message>${m}</message></root>`;
    if (cmd === 8) { const s = guild.status(db, pl); return `<root code="0"><min_user_level>1</min_user_level><member_status>${s.member_status}</member_status><groupid>${s.groupid}</groupid></root>`; }
    if (cmd === 7) return `<root code="0"><cash>${guild.CREATE_COST}</cash></root>`;
    if (cmd === 3) { const r = guild.create(db, pl, p.GroupName, p.Desc); return r.error ? bad(r.error) : `<root code="0"><groupid>${r.id}</groupid></root>`; }
    if (cmd === 2) { const x = guild.detailXml(db, pl, Number(p.GroupId)); return x ? `<root code="0">${x}</root>` : bad('no such group'); }
    if (cmd === 6) { const r = guild.join(db, pl, Number(p.GroupId)); return r.error ? bad(r.error) : '<root code="0"></root>'; }
    if (cmd === 9) { const g = guild.myGroup(db, pl.uid, pl.server_id); return g ? `<root code="0">${guild.buildingsXml(g)}</root>` : bad('no group'); }
    if (cmd === 10) { guild.quit(db, pl); return '<root code="0"></root>'; }
    return `<root code="0">${guild.listXml(db, pl)}</root>`;
  },
  rl_w_group_admin: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 1) { const x = guild.adminXml(db, pl); return x ? `<root code="0">${x}</root>` : '<root code="5"><message>no group</message></root>'; }
    return '<root code="0"></root>';
  },

  rl_r_group_rank: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return pl ? `<root code="0">${guild.rankXml(db, pl)}</root>` : '<root code="3"><message>session expired</message></root>';
  },
  rl_r_group_hall: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 2) { const r = guild.checkin(db, pl, Number(p.TaskID)); return r.error ? `<root code="5"><message>${r.error}</message></root>` : `<root code="0">${r.xml}</root>`; }
    const x = guild.hallXml(db, pl);
    return x ? `<root code="0">${x}</root>` : '<root code="5"><message>no group</message></root>';
  },
  rl_r_group_store: () => `<root code="0">${guild.shopXml()}</root>`,
  rl_r_group_contri: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 2) { const r = guild.donate(db, pl, p.Cash); return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0"></root>'; }
    const x = guild.contriXml(db, pl);
    return x ? `<root code="0">${x}</root>` : '<root code="5"><message>no group</message></root>';
  },

  // Reincarnation / equipment advance. Cmd 8 = info for the screen, Cmd 7 = do it (ReadyCard keeps, EatCard is consumed).
  rl_w_newlife: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 8) return `<root code="0"><info><max_lv>${game.NEWLIFE_MAX(2)}</max_lv><coin>${game.NEWLIFE_COST(1)}</coin></info></root>`;
    const r = game.newlife(db, pl, Number(p.ReadyCard), Number(p.EatCard), Number(p.NewLifeCount));
    return r.error ? `<root code="5"><message>${r.error}</message></root>` : `<root code="0"><newlife count="${r.grade}"/><addattack>${r.gain}</addattack><adddefend>${Math.round(r.gain / 2)}</adddefend></root>`;
  },

  // Potential training ("Train" icon): Cmd 1 = load card, 2 = roll (CostId), 3 = save the rolled gains.
  rl_x_develop: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const bag = Number(p.BagId), cmd = Number(p.Cmd);
    if (cmd === 1) { const x = game.potentialXml(db, pl, bag); return x ? `<root code="0">${x}</root>` : '<root code="5"><message>no such card</message></root>'; }
    if (cmd === 2) { const d = game.potentialRoll(db, pl, bag, Number(p.CostId)); return d.error ? `<root code="5"><message>${d.error}</message></root>` : `<root code="0"><add_num att="${d.att}" def="${d.def}" ckr="${d.ckr}"/><cost miyao="0" yuanbao="0"/></root>`; }
    return game.potentialSave(db, pl, bag) ? '<root code="0"></root>' : '<root code="5"><message>no such card</message></root>';
  },

  // Misc "comm" screens. Read (Cmd 20/8 evolve, 13 consumption, 15/18 slot machine, 9 inherit, 16 shop-ish) and write (28 evolve).
  rl_r_comm: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd);
    if (cmd === 16) return '<root code="0"><basic><status>2</status><amount>4900</amount><current>4900</current></basic><awards><item icon1="props_015" icon2="props_049" icon3="props_073"><id>1</id><num>1</num></item></awards></root>';
    if (cmd === 3) return '<root code="0">' + mora.infoXml(db, pl) + '</root>';
    if (cmd === 20) return '<root code="0"><basic><prop_num>99</prop_num></basic></root>';
    if (cmd === 8) return '<root code="0"><basic><cost_prop>1</cost_prop><prop_num>99</prop_num></basic></root>';
    if (cmd === 13) return '<root code="0"><basic><cash>0</cash><remain>86400</remain></basic><award dropid="1"><cardlist></cardlist><proplist></proplist><chipbag></chipbag><coin>0</coin><cash>0</cash><exp>0</exp><chip>0</chip><action>0</action><merit>0</merit><pk_action>0</pk_action><soul>0</soul></award></root>';
    if (cmd === 15) return '<root code="0">' + slot.info(db, pl) + '</root>';
    if (cmd === 18) return '<root code="0">' + slot.listXml(db, pl) + '</root>';
    if (cmd === 9) return '<root code="0"><basic><cost_cash>0</cost_cash><level>1</level><star>0</star><newlife>0</newlife><add_attack>0</add_attack><add_defense>0</add_defense></basic></root>';
    return '<root code="0"></root>';
  },
  rl_w_comm: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const wc = Number(p.Cmd);
    if (wc === 24) return '<root code="0">' + slot.bet(db, pl) + '</root>';
    if (wc === 23) { const r = slot.spin(db, pl); return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>'; }
    if (wc === 25) { const r = slot.exchange(db, pl, Number(p.Id || p.PackageID || p.ID)); return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>'; }
    if (wc === 4) { const r = mora.play(db, pl, Number(p.GambleNPCID), Number(p.GambleMustWin) === 1); return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>'; }
    if (wc === 7) { const r = mora.buyLife(db, pl, Number(p.GambleCashType)); return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0"></root>'; }
    if (wc === 5 || wc === 6) { const r = mora.exchange(db, pl, Number(p.GambleExchangeID)); return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>'; }
    if (Number(p.Cmd) === 26) { // 49$ gift: free here
      const done = db.prepare("SELECT 1 FROM actclaim WHERE uid=? AND server_id=? AND actid=9026").get(pl.uid, pl.server_id);
      if (done) return '<root code="610002"><message>received</message></root>';
      db.prepare('INSERT INTO actclaim(uid,server_id,actid,subid) VALUES(?,?,9026,1)').run(pl.uid, pl.server_id);
      db.prepare('UPDATE players SET gold=gold+4900 WHERE uid=? AND server_id=?').run(pl.uid, pl.server_id);
      return '<root code="0">' + game.awardFull({ cash: 4900 }) + '</root>';
    }
    if (Number(p.Cmd) === 28) {
      const r = game.godSynth(db, pl, Number(p.AttackCardBagIndex), Number(p.DefenseCardBagIndex));
      if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
      return '<root code="0"><prop_num>0</prop_num>' + game.awardXml(r) + '</root>';
    }
    return '<root code="0"></root>';
  },

  // "Save time": trade ramen (prop 3) for exp + silver based on the current training chapter. Cmd 1 = info, Cmd 2 = exchange one.
  rl_r_savetime: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const sid = Number(p.ServerID || 1);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, sid);
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const RAMEN = 3, chap = game.getStage(db, pl.uid, sid, 1000), exp = 500 * Math.max(1, pl.level), coin = 500 * Math.max(1, pl.level);
    let have = game.propCounts(db, pl.uid, sid)[RAMEN];
    if (have === undefined) { game.propAdd(db, pl.uid, sid, RAMEN, 99); have = 99; }
    if (Number(p.Cmd) === 2) {
      if (have < 1) return '<root code="5"><message>no ramen</message></root>';
      game.propAdd(db, pl.uid, sid, RAMEN, -1); game.addExp(db, pl, exp);
      db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, sid);
      return `<root code="0"><basic><ratio>1</ratio><exp>${exp}</exp><coin>${coin}</coin><remain>${have - 1}</remain></basic></root>`;
    }
    return `<root code="0"><basic><chapter>${chap}</chapter><round>1</round><prop_num>${have}</prop_num><total_trans>99</total_trans><used_trans>0</used_trans><cost_cash>10</cost_cash><vip_add>99</vip_add><exp>${exp}</exp><coin>${coin}</coin><vip_limit>1</vip_limit><level_limit>1</level_limit></basic></root>`;
  },

  // Mail actions (read / delete / accept): nothing to change on this server, acknowledge.
  rl_w_msg: () => '<root code="0"></root>',

  // Invitation code (settings): any non-empty code pays 500 gold, once per code per player.
  rl_w_invitecode: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const code = String(p.Code || '').trim();
    if (!code) return '<root code="5"><message>empty code</message></root>';
    db.exec('CREATE TABLE IF NOT EXISTS invites (uid INTEGER, server_id INTEGER, code TEXT, PRIMARY KEY(uid,server_id,code))');
    if (db.prepare('SELECT 1 FROM invites WHERE uid=? AND server_id=? AND code=?').get(pl.uid, pl.server_id, code)) return '<root code="5"><message>code already used</message></root>';
    db.prepare('INSERT INTO invites VALUES(?,?,?)').run(pl.uid, pl.server_id, code);
    db.prepare('UPDATE players SET gold=gold+500 WHERE uid=? AND server_id=?').run(pl.uid, pl.server_id);
    return '<root code="0">' + game.awardFull({ cash: 500 }) + '</root>';
  },

  // Money tree: shake for silver. 5 free shakes a day, then 20 gold each; reward = start silver * random multiple (low..top).
  rl_r_mtree: ({ db, params: p }) => mtree(db, p, false),
  rl_w_mtree: ({ db, params: p }) => mtree(db, p, true),

  // Ramen shop: eating restores energy to full (client sets energy/action to max itself).
  rl_w_ramen: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    db.prepare('UPDATE players SET energy=MAX(energy,106) WHERE uid=? AND server_id=?').run(acc.uid, Number(p.ServerID || 1));
    return '<root code="0"></root>';
  },

  // Wheel of Fortune ranking and its rank / points gifts.
  rl_r_fwheel_rank: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    return pl ? '<root code="0">' + rankings.wheelRankXml(db, pl) + '</root>' : '<root code="3"><message>session expired</message></root>';
  },
  rl_w_wheel_gift: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = rankings.wheelGift(db, pl, Number(p.Cmd), Number(p.GiftId));
    return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>';
  },

  // Arena extras: Cmd 1 = exchange tab opened, Cmd 2 = exchange reputation (prop 9996) for exchange_award row Exchg,
  // Cmd 3 = daily rank reward.
  rl_x_sport_ext: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd);
    if (cmd === 2) {
      const row = game.table('exchange_award').rows.find((r) => r[0] === Number(p.Exchg));
      if (!row) return '<root code="5"><message>bad item</message></root>';
      const rep = game.propCounts(db, pl.uid, pl.server_id)[9996] || 0;
      if (rep < row[6]) return '<root code="5"><message>not enough reputation</message></root>';
      game.propAdd(db, pl.uid, pl.server_id, 9996, -row[6]);
      return '<root code="0">' + game.grantDrop(db, pl, row[7]) + '</root>';
    }
    if (cmd === 3) {
      db.exec('CREATE TABLE IF NOT EXISTS rank_claims (uid INTEGER, server_id INTEGER, board TEXT, key TEXT, PRIMARY KEY(uid,server_id,board,key))');
      const ok = db.prepare('INSERT OR IGNORE INTO rank_claims VALUES(?,?,?,?)').run(pl.uid, pl.server_id, 'arena', new Date().toISOString().slice(0, 10)).changes;
      if (!ok) return '<root code="5"><message>already claimed today</message></root>';
      const r = db.prepare('SELECT rank FROM arena WHERE uid=?').get(pl.uid);
      const rank = r ? r.rank : 999, coin = Math.max(2000, 50000 - rank * 1000), rep = Math.max(50, 1000 - rank * 20);
      game.propAdd(db, pl.uid, pl.server_id, 9996, rep);
      db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, pl.server_id);
      return '<root code="0">' + game.awardFull({ coin }) + '</root>';
    }
    // Cmd 1: the client treats a code-0 reply as a reward to show (and crashes without one); the list itself comes
    // from the client's exchange_award table, so answer "nothing to collect".
    return '<root code="1"></root>';
  },

  // World boss (fightBossView.lua). Cmd 1 info, 3 dice, 4 claim rank award, 6 hero ranking, 7 exchange, 8 boss hp, 10 clear cd, 11 fight feed.
  rl_w_xiao: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const cmd = Number(p.Cmd), wrap = (r) => (r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>');
    if (cmd === 3) return wrap(boss.dice(db, pl));
    if (cmd === 4) return wrap(boss.claim(db, pl));
    if (cmd === 6) return '<root code="0">' + boss.heroXml(db, pl) + '</root>';
    if (cmd === 7) return wrap(boss.exchange(db, pl, Number(p.Exchangeid)));
    if (cmd === 8) return '<root code="0">' + boss.bossInfo(db, pl) + '</root>';
    if (cmd === 9) return '<root code="0"><preview addval="0" addall="0"/></root>';
    if (cmd === 10) return wrap(boss.clearCd(db, pl));
    if (cmd === 11) return '<root code="0">' + boss.msgs(db, pl, Number(p.MsgImportID), Number(p.MsgNormalID)) + '</root>';
    return '<root code="0">' + boss.infoXml(db, pl) + '</root>';
  },
  rl_w_xiao_war: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = boss.fight(db, pl);
    return r.error ? `<root code="5"><message>${r.error}</message></root>` : '<root code="0">' + r.xml + '</root>';
  },

  // Growth / star strengthening (rl_w_star): Cmd 3 = rate table, others = do one upgrade attempt.
  rl_w_star: ({ db, params: p }) => {
    if (Number(p.Cmd) === 3) {
      let items = '';
      for (let i = 0; i < 20; i++) items += `<item star_now="${i}" max_percent="${Math.max(30, 100 - i * 4)}" stone_level="1" stone_added_percent="10"/>`;
      return '<root code="0"><star_list>' + items + '</star_list></root>';
    }
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = game.sageGrow(db, pl, Number(p.ReadyCard), Number(p.StarStoneID), Number(p.StarStoneNum));
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return `<root code="0" levelSuccess="${r.win ? 1 : 0}" levelDrop="${r.drop}" currentLevel="${r.lv}" propLeft="${r.left}" extPropLeft="0"></root>`;
  },

  rl_r_friend: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + game.friendsXml(db, pl) + '</root>';
  },
  rl_r_nickinfo: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + game.friendsXml(db, pl, String(p.Nick || '')) + '</root>';
  },
  // Friend actions. With Msg + ToUid it is a chat/invite message: delivered to the other player's mailbox.
  rl_w_friend: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (pl && p.Msg && Number(p.ToUid)) {
      db.exec('CREATE TABLE IF NOT EXISTS mail (id INTEGER PRIMARY KEY AUTOINCREMENT, to_uid INTEGER, from_nick TEXT, text TEXT, ts INTEGER)');
      db.prepare('INSERT INTO mail(to_uid,from_nick,text,ts) VALUES(?,?,?,?)').run(Number(p.ToUid), pl.nick, String(p.Msg).slice(0, 200), Math.floor(Date.now() / 1000));
    }
    return '<root code="0"></root>';
  },

  // Arena (ranked ladder): rl_r_sport Cmd 2000-ish = list, rl_r_sportrank = top 50, rl_w_sport Cmd 2008 = fight (ToRank).
  rl_r_sport: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    return '<root code="0">' + game.arenaListXml(db, pl) + '</root>';
  },
  rl_r_sportrank: ({ db }) => '<root code="0">' + game.arenaRankXml(db) + '</root>',
  rl_w_sport: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, Number(p.ServerID || 1));
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    const r = game.arenaFight(db, pl, Number(p.ToRank));
    if (r.error) return `<root code="5"><message>${r.error}</message></root>`;
    return '<root code="0">' + r.xml.replace('</fight>', '</fight>') + `<sport renown_delta="${r.renown}" fromrank="${r.from}" torank="${r.to}"/>` +
      '<userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>' + game.awardFull({ coin: r.win ? 300 : 0 }) + '</root>';
  },

  // Battles / tower ("dup"): Cmd 7000 = chapter list; rl_w_dup Cmd 3100 (Chap, Round) = fight. A chapter has 6 rounds; process = the round to fight next.
  rl_r_dup: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const sid = Number(p.ServerID || 1);
    if (Number(p.Cmd) === 7001) {
      const pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, sid);
      return pl ? '<root code="0">' + rankings.towerRankXml(db, pl) + '</root>' : '<root code="3"><message>session expired</message></root>';
    }
    if (Number(p.Cmd) === 7002) {
      // Sweep screen: one entry per tower round (3 chapters x 6 rounds, id = (chap-1)*6+round); selectable once cleared.
      const used = acc ? sweepsUsed(db, acc.uid, sid) : 0;
      let list = '';
      for (let c = 1; c <= 3; c++) for (let r = 1; r <= 6; r++) {
        const done = acc && game.getStage(db, acc.uid, sid, 1000 + c) > r;
        list += `<dup name="${c}-${r}" selectable="${done ? 1 : 0}"/>`;
      }
      return `<root code="0"><dup_count><total>${SWEEP_DAILY}</total><remain>${Math.max(0, SWEEP_DAILY - used)}</remain><vip>0</vip></dup_count><dup_list>${list}</dup_list></root>`;
    }
    const chaps = [1, 2, 3].map((c) => `<dup><chapid>${c}</chapid><process>${acc ? game.getStage(db, acc.uid, sid, 1000 + c) : 1}</process></dup>`).join('');
    return `<root code="0"><duplist maxchap="3" current_round="1" remain_reset_count="3" status="0">${chaps}</duplist></root>`;
  },
  rl_w_dup: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    const sid = Number(p.ServerID || 1);
    let pl = acc && db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, sid);
    if (!pl) return '<root code="3"><message>session expired</message></root>';
    if (Number(p.Cmd) === 3102) {
      // Sweep: DupId = 'id|id|..'; each costs one of the daily sweeps and pays the same reward as winning that round.
      const ids = String(p.DupId || '').split('|').map(Number).filter((n) => n >= 1 && n <= 18);
      const used = sweepsUsed(db, pl.uid, sid);
      if (!ids.length || used + ids.length > SWEEP_DAILY) return '<root code="5"><message>no sweeps left</message></root>';
      let list = '';
      for (const id of ids) {
        const c = Math.ceil(id / 6), r = ((id - 1) % 6) + 1;
        if (game.getStage(db, pl.uid, sid, 1000 + c) <= r) return '<root code="5"><message>round not cleared</message></root>';
        const ex = 60 * c, co = 90 * c;
        game.addExp(db, pl, ex);
        pl = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(pl.uid, sid);
        db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(co, pl.uid, sid);
        list += `<dup name="${c}-${r}">${game.awardFull({ coin: co, exp: ex })}</dup>`;
      }
      game.setStage(db, pl.uid, sid, sweepKey(), used + ids.length + 1);
      return '<root code="0"><dup_list>' + list + '</dup_list></root>';
    }
    const chap = Number(p.Chap || 1), round = Number(p.Round || 1);
    const exp = 60 * chap, coin = 90 * chap;
    game.addExp(db, pl, exp);
    db.prepare('UPDATE players SET coin=coin+? WHERE uid=? AND server_id=?').run(coin, pl.uid, sid);
    game.setStage(db, pl.uid, sid, 1000 + chap, round + 1);
    game.bumpTask(db, pl.uid, sid, 1);
    return '<root code="0"><userinfo><LastSPUpdatePastTime>0</LastSPUpdatePastTime></userinfo>' + game.battleXml(db, pl, chap, round * 5, { enemyLevel: 10 * chap }) + game.awardFull({ coin, exp }) + '</root>';
  },

  // Daily tasks: Cmd 1 = list, Cmd 2 = claim an award (AwardID).
  rl_r_dailytask: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const sid = Number(p.ServerID || 1);
    if (Number(p.Cmd) === 2) {
      const pl = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, sid);
      const a = game.dailyClaim(db, pl, Number(p.AwardID));
      if (!a) return '<root code="5"><message>bad award</message></root>';
      return '<root code="0">' + game.awardFull({ coin: a.coin, cash: a.cash }) + '</root>';
    }
    return '<root code="0">' + game.dailyXml(db, acc.uid, sid) + '</root>';
  },

  // Training: open a chapter. Cmd 2 / ChapID -> which stages are open.
  rl_w_pve: ({ db, params: p }) => {
    const acc = accountBySession(db, p);
    if (!acc) return '<root code="3"><message>session expired</message></root>';
    const sid = Number(p.ServerID || 1);
    const pl0 = db.prepare('SELECT * FROM players WHERE uid=? AND server_id=?').get(acc.uid, sid);
    if (Number(p.Cmd) === 3) return trainingFight(db, pl0, Number(p.ChapID || 1), Number(p.StageID || 1));
    const cur = game.getStage(db, acc.uid, sid, Number(p.ChapID || 1));
    let stages = '';
    for (let i = 1; i <= cur; i++) stages += `<stage stageid="${i}" pos="1" pos_time="0" pk_boss_times="0"/>`;
    return `<root code="0"><preview currentstage="${cur}" laststage="${cur}"/><stagelist>${stages}</stagelist><expbuf addrate="0" exp_time="0"/></root>`;
  },

  // Shop. Cmd 1600 = gift packs, 1601 = goods. An EMPTY list crashes the client, so always send >= 1 entry.
  rl_r_shoplist: ({ db, params: p }) => {
    const shopOwned = (q) => { const a = accountBySession(db, q); return a ? game.propCounts(db, a.uid, Number(q.ServerID || 1)) : {}; };
    const recruits = [
      { recruit_id: 1, recruit_yuanbao: 300, recruit_time: 0, last_recruit_time: 0, first_yuanbao: 0, free_recruit_time_left: 0, recruit_limit: 0, cur_recruit_count: 0 },
      { recruit_id: 2, recruit_yuanbao: 150, recruit_time: 0, last_recruit_time: 0, first_yuanbao: 0, free_recruit_time_left: 0, recruit_limit: 0, cur_recruit_count: 0 },
      { recruit_id: 3, recruit_yuanbao: 0, recruit_time: 86400, last_recruit_time: 0, first_yuanbao: 0, free_recruit_time_left: 0, recruit_limit: 0, cur_recruit_count: 0 },
    ];
    const rows = (tag, list) => list.map((o) => `<${tag}>` + Object.entries(o).map(([k, v]) => el(k, v)).join('') + `</${tag}>`).join('');
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const n = (v) => Math.round(Number(v) || 0);
    if (Number(p.Cmd) === 1600) {
      const packs = game.table('giftinfo').rows.map((r, k) => ({
        package_id: r[0], package_name: esc(r[2]), package_icon: r[3], package_yuanbao: r[4], package_yinzi: r[5], package_show: 1,
        package_function: r[7], package_function_value1: n(r[8]), package_function_value2: n(r[9]), package_function_value3: n(r[10]), package_function_value4: n(r[11]),
      }));
      return '<root code="0"><shoplist>' + rows('packages', packs) + rows('recruit', recruits) + '</shoplist></root>';
    }
    const owned = shopOwned(p);
    const goods = game.table('consumeinfo').rows.filter((r) => r[4] > 0 || r[5] > 0).map((r, k) => ({
      propid: r[0], prop_name: esc(r[2]), prop_icon: r[3], prop_yuanbao: r[4], prop_yinzi: r[5], prop_show: 1, prop_function: r[7],
      prop_function_value1: n(r[8]), prop_function_value2: n(r[9]), prop_function_value3: n(r[10]), prop_function_value4: n(r[11]), bagnum: owned[r[1]] || 0, prop_order: k + 1,
    }));
    return '<root code="0"><shoplist>' + rows('goods', goods) + rows('recruit', recruits) + '<limit><actiongoods><total>0</total><rest>0</rest></actiongoods><bingliangwan><total>0</total><rest>0</rest></bingliangwan></limit></shoplist></root>';
  },
};
