# Pushing client fixes without a new APK (hot update)

The game has its own resource updater. It is driven by `rl_r_version`:
`<updatechip><version val="X"/><cdn>http://host/cdn/</cdn><filelist><file name="X_update.zip" val="X" md5 size/></filelist></updatechip>`.

1. Put changed files in `cdn/src/` with the same paths as inside the OBB, e.g. `cdn/src/script/ui_layer/ui_purchaseLayer.lua`.
2. Run `python -I tools/build_cdn.py 28.0.4` (always a HIGHER version than the last one).
3. Restart not needed: the next game start shows "confirm update?", downloads, unzips to `files/renlong28/`, and the game loads those files first.

Rules learned the hard way: the zip name must start with the version followed by `_`; the zip needs explicit folder entries
and everything under `renlong28/` (build_cdn.py does both). `<updateversion>` is the separate APK updater and must stay at 0.0.1.

Shipped so far: 28.0.3 = ui_purchaseLayer.lua (top-up buttons call rl_x_free_topup instead of Google Play).
