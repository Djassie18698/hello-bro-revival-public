"""One-time setup for a fresh server install (public package).
The game files are NOT shipped with this project. Bring your own copy of the original
Hello Bro v28.0 XAPK; this script reads it and:
  1. extracts the game's data tables (tables.bin inside the OBB) to data/*.json for the server
  2. builds HelloBro-<address>.apk that connects to your server address (needs a JDK for jarsigner)

usage: python -I tools/setup_from_xapk.py <HelloBro.xapk> <server-address:port>
"""
import io, json, os, subprocess, sys, zipfile

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
sys.path.insert(0, here)
import mbs  # noqa: E402

xapk_path, address = sys.argv[1], sys.argv[2]
x = zipfile.ZipFile(xapk_path)
obb_name = next(n for n in x.namelist() if n.endswith('.obb'))
apk_name = next(n for n in x.namelist() if n.endswith('.apk'))

# 1. data tables
obb = zipfile.ZipFile(io.BytesIO(x.read(obb_name)))
# tables.bin is a zip whose local-header magic was changed from PK to @B>R; put it back.
raw = obb.read('tables.bin').replace(b'@B>R\x14\x00', b'PK\x03\x04\x14\x00')
tables = zipfile.ZipFile(io.BytesIO(raw))
data_dir = os.path.join(root, 'data')
os.makedirs(data_dir, exist_ok=True)
tmp = os.path.join(root, 'data', '_tmp.dbf')
ok = 0
for n in tables.namelist():
    if not n.endswith('.dbf'):
        continue
    open(tmp, 'wb').write(tables.read(n))
    try:
        t, rows, _ = mbs.parse(tmp)
        name = os.path.basename(n)[:-4]
        with open(os.path.join(data_dir, name + '.json'), 'w', encoding='utf8') as fh:
            json.dump({'types': t, 'rows': [[i] + r for i, r in rows]}, fh, ensure_ascii=False)
        ok += 1
    except Exception as e:  # a few tables use another layout; the server does not need them
        print('skipped', n, e)
os.remove(tmp)
print(ok, 'data tables written to', data_dir)

# 2. client APK pointed at this server
base_apk = os.path.join(root, '_base.apk')
open(base_apk, 'wb').write(x.read(apk_name))
out = os.path.join(root, 'HelloBro-%s.apk' % address.replace(':', '_'))
subprocess.check_call([sys.executable, '-I', os.path.join(here, 'patch_apk.py'), base_apk, out, address])
os.remove(base_apk)
print('Players install', out, 'plus the OBB from the same XAPK (Android/obb/com.hello.bro.yo/).')
