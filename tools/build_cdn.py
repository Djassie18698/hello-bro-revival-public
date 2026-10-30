"""Pack cdn/src/ (files laid out like inside the OBB, e.g. script/ui_layer/x.lua) into cdn/update-<val>.zip
and write cdn/manifest.json for rl_r_version. usage: python -I tools/build_cdn.py <val e.g. 28.0.1>"""
import hashlib, json, os, sys, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cdn = os.path.join(root, 'cdn')
val = sys.argv[1]
PREFIX = 'renlong28/'  # the client adds <files>/renlong28/ and <files>/renlong28/script/ to its search path
name = '%s_update.zip' % val  # the client reads the target version from the file name, up to the first '_'
with zipfile.ZipFile(os.path.join(cdn, name), 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(os.path.join(cdn, 'src')):
        rel = os.path.relpath(d, os.path.join(cdn, 'src')).replace(os.sep, '/')
        z.writestr(PREFIX + ('' if rel == '.' else rel + '/'), b'')  # the client's unzip only creates folders that have their own entry
        for f in files:
            full = os.path.join(d, f)
            z.write(full, PREFIX + os.path.relpath(full, os.path.join(cdn, 'src')).replace(os.sep, '/'))
data = open(os.path.join(cdn, name), 'rb').read()
man = {'val': val, 'files': [{'name': name, 'val': val, 'md5': hashlib.md5(data).hexdigest(), 'size': len(data)}]}
json.dump(man, open(os.path.join(cdn, 'manifest.json'), 'w'), indent=1)
print(man)
