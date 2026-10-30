// Admin panel: http://<server>:18080/admin  (offline hobby server: open to everyone who can reach it, no password)
const game = require('./game');
const vip = require('./vip');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hello Bro Admin</title>
<style>
 body{font-family:system-ui,sans-serif;background:#14161f;color:#eee;margin:0;padding:16px;max-width:900px;margin:auto}
 h1{color:#ffb84d} .card{background:#1f2330;border-radius:10px;padding:14px;margin:12px 0}
 input,select,button{font-size:15px;padding:8px;border-radius:6px;border:1px solid #444;background:#2a3042;color:#eee}
 button{background:#e8742a;border:0;cursor:pointer} button:hover{background:#ff8c3d}
 table{width:100%;border-collapse:collapse} td,th{padding:6px;text-align:left;border-bottom:1px solid #333}
 .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0} small{color:#9aa}
 #msg{position:fixed;right:16px;bottom:16px;background:#2e7d32;padding:10px 14px;border-radius:8px;display:none}
</style></head><body>
<h1>Hello Bro Admin</h1>
<small>Anyone who can open this page can change any player. Offline / hobby use only.</small>
<div class="card"><h3>Players</h3><table id="players"></table></div>
<div class="card"><h3>Give resources</h3>
 <div class="row"><select id="uid"></select>
 <select id="field"><option value="gold">Gold (ingots)</option><option value="coin">Coins</option><option value="energy">Energy</option><option value="level">Set level</option><option value="renown">Arena reputation</option><option value="souls">Ninja souls</option><option value="vip">Set VIP level (0-18)</option></select>
 <input id="amount" type="number" value="10000" style="width:120px"><button onclick="give()">Add / Set</button></div></div>
<div class="card"><h3>Give a character</h3>
 <div class="row"><input id="q" placeholder="Search name (Naruto, Itachi...)" oninput="search()" style="flex:1;min-width:200px">
 <select id="ninja" style="min-width:260px"></select><input id="count" type="number" value="1" style="width:70px"><button onclick="giveCard()">Give</button></div>
 <small>Stars shown after the name. Same player as selected above.</small></div>
<div class="card"><h3>Give an item or equipment</h3>
 <div class="row"><input id="q2" placeholder="Search items / equipment (ramen, sword, pill...)" oninput="search2()" style="flex:1;min-width:200px">
 <select id="thing" style="min-width:260px"></select><input id="count2" type="number" value="1" style="width:70px"><button onclick="giveThing()">Give</button></div>
 <small>Items go into the backpack, equipment arrives as cards. Same player as selected above.</small></div>
<div id="msg"></div>
<script>
const $=id=>document.getElementById(id);
async function api(p,b){const r=await fetch('/admin/api/'+p,b?{method:'POST',body:JSON.stringify(b)}:{});return r.json();}
function toast(t){const m=$('msg');m.textContent=t;m.style.display='block';setTimeout(()=>m.style.display='none',2500);}
async function load(){const d=await api('players');
 $('players').innerHTML='<tr><th>UID</th><th>Name</th><th>Lv</th><th>Gold</th><th>Coins</th><th>Energy</th><th>Cards</th></tr>'+d.map(p=>'<tr><td>'+p.uid+'</td><td>'+p.nick+'</td><td>'+p.level+'</td><td>'+p.gold+'</td><td>'+p.coin+'</td><td>'+p.energy+'</td><td>'+p.cards+'</td></tr>').join('');
 const keep=$('uid').value;$('uid').innerHTML=d.map(p=>'<option value="'+p.uid+'">'+p.nick+' ('+p.uid+')</option>').join('');if(keep)$('uid').value=keep;}
async function give(){const r=await api('give',{uid:+$('uid').value,field:$('field').value,amount:+$('amount').value});toast(r.ok?'Done':r.error);load();}
async function search(){const d=await api('ninjas?q='+encodeURIComponent($('q').value));$('ninja').innerHTML=d.map(n=>'<option value="'+n.id+'">'+n.name+' '+'★'.repeat(n.stars)+' (#'+n.id+')</option>').join('');}
async function giveCard(){const r=await api('givecard',{uid:+$('uid').value,ninja:+$('ninja').value,count:+$('count').value});toast(r.ok?'Card(s) added - restart the game to see them':r.error);load();}
async function search2(){const d=await api('things?q='+encodeURIComponent($('q2').value));$('thing').innerHTML=d.map(n=>'<option value="'+n.kind+':'+n.id+'">'+n.name+' ['+n.kind+(n.stars?' '+'★'.repeat(n.stars):'')+']</option>').join('');}
async function giveThing(){const [k,i]=$('thing').value.split(':');const r=await api('givething',{uid:+$('uid').value,kind:k,id:+i,count:+$('count2').value});toast(r.ok?'Given - reopen the screen in game to see it':r.error);load();}
load();search();search2();
</script></body></html>`;

const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

// Private play: no password. Public server: set ADMIN_PASSWORD; the browser then asks for it (user name is ignored).
function authorized(req) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const given = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  return given === pw;
}

module.exports = async function admin(req, res, u, db, readBody) {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Hello Bro admin"' });
    return res.end('password required');
  }
  if (u.pathname === '/admin' || u.pathname === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  game.ensure(db);
  if (u.pathname === '/admin/api/players') {
    return json(res, db.prepare(`SELECT p.uid,p.nick,p.level,p.gold,p.coin,p.energy,p.server_id,
      (SELECT COUNT(*) FROM cards c WHERE c.uid=p.uid AND c.server_id=p.server_id) cards FROM players p ORDER BY p.uid`).all());
  }
  if (u.pathname === '/admin/api/ninjas') {
    const q = String(u.query.q || '').toLowerCase();
    const out = [];
    for (const r of game.ninjas().values()) {
      // base character rows only (col 4 == 1), skip equipment-like duplicates
      if (r[4] !== 1) continue;
      if (q && !String(r[2]).toLowerCase().includes(q)) continue;
      out.push({ id: r[0], name: r[2], stars: r[11] || 0 });
      if (out.length >= 40) break;
    }
    return json(res, out);
  }
  if (u.pathname === '/admin/api/things') {
    const q = String(u.query.q || '').toLowerCase();
    const out = [];
    for (const r of game.table('consumeinfo').rows) { if (!q || String(r[2]).toLowerCase().includes(q)) out.push({ kind: 'item', id: r[1], name: r[2], stars: 0 }); if (out.length >= 40) break; }
    for (const r of game.table('equipmentinfo').rows) { if (out.length >= 80) break; if (!q || String(r[2]).toLowerCase().includes(q)) out.push({ kind: 'equip', id: r[0], name: r[2], stars: r[6] }); }
    return json(res, out);
  }
  if (req.method === 'POST') {
    let b;
    try { b = JSON.parse(await readBody(req)); } catch { return json(res, { ok: false, error: 'bad json' }); }
    const pl = db.prepare('SELECT * FROM players WHERE uid=?').get(b.uid);
    if (!pl) return json(res, { ok: false, error: 'no such player' });
    if (u.pathname === '/admin/api/give') {
      if (b.field === 'renown' || b.field === 'souls') { game.propAdd(db, pl.uid, pl.server_id, b.field === 'renown' ? 9996 : 9999, Math.trunc(Number(b.amount)) || 0); return json(res, { ok: true }); }
      if (b.field === 'vip') { vip.setLevel(db, pl.uid, pl.server_id, Number(b.amount)); return json(res, { ok: true }); }
      const col = { gold: 'gold', coin: 'coin', energy: 'energy', level: 'level' }[b.field];
      if (!col) return json(res, { ok: false, error: 'bad field' });
      const amt = Math.trunc(Number(b.amount));
      if (!Number.isFinite(amt)) return json(res, { ok: false, error: 'bad amount' });
      const sql = (col === 'level' || col === 'vip') ? `UPDATE players SET ${col}=? WHERE uid=?` : `UPDATE players SET ${col}=${col}+? WHERE uid=?`;
      db.prepare(sql).run(amt, b.uid);
      return json(res, { ok: true });
    }
    if (u.pathname === '/admin/api/givething') {
      const n = Math.min(Math.max(Math.trunc(b.count) || 1, 1), 999);
      if (b.kind === 'item') { game.propAdd(db, pl.uid, pl.server_id, b.id, n); return json(res, { ok: true }); }
      if (b.kind === 'equip') { for (let i = 0; i < Math.min(n, 50); i++) if (!game.giveEquip(db, pl.uid, pl.server_id, b.id)) return json(res, { ok: false, error: 'unknown equipment' }); return json(res, { ok: true }); }
      return json(res, { ok: false, error: 'bad kind' });
    }
    if (u.pathname === '/admin/api/givecard') {
      if (!game.ninjas().has(b.ninja)) return json(res, { ok: false, error: 'unknown character' });
      const n = Math.min(Math.max(Math.trunc(b.count) || 1, 1), 100);
      for (let i = 0; i < n; i++) game.giveCard(db, pl.uid, pl.server_id, b.ninja);
      return json(res, { ok: true });
    }
  }
  res.writeHead(404); res.end('not found');
};
