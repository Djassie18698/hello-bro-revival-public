"""Point the Hello Bro APK at your own server and re-sign it.
usage: python patch_apk.py <original.apk> <out.apk> <host:port> [patched classes.dex]
Needs a JDK (keytool + jarsigner) on PATH. No downloads."""
import json, os, subprocess, sys, zipfile, tempfile

src, out, host = sys.argv[1:4]
dex = sys.argv[4] if len(sys.argv) > 4 else None   # optional patched classes.dex
cfg = [{
    "server": {"url": f"http://{host}", "cgi": "xk_w_login", "cmd": 2, "Pt": 1062, "GroupID": 2},
    "localCache": 2, "Recommend": 1000,
    "AreaUrl": f"http://{host}/xk_r_dir", "servername": "Revival",
}]
patched = {"assets/baseconfig.json", "assets/baseconfig_o.json"}
tmp = out + ".unsigned"
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zo:
    for it in zi.infolist():
        if it.filename.startswith("META-INF/"):
            continue                       # drop the old signature
        data = json.dumps(cfg, indent=1).encode() if it.filename in patched else zi.read(it.filename)
        if dex and it.filename == 'classes.dex':
            data = open(dex, 'rb').read()
        zo.writestr(it, data)
ks = os.path.join(os.path.dirname(os.path.abspath(out)), "revival.keystore")
if not os.path.exists(ks):
    subprocess.check_call(["keytool", "-genkeypair", "-keystore", ks, "-storepass", "revival", "-keypass", "revival",
        "-alias", "revival", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=HelloBroRevival"])
subprocess.check_call(["jarsigner", "-keystore", ks, "-storepass", "revival", "-sigalg", "SHA256withRSA",
    "-digestalg", "SHA-256", "-signedjar", out, tmp, "revival"])
os.remove(tmp)
print("wrote", out)
