#!/usr/bin/env bash
# Builds the release downloads into dist/:
#   neon-keys-<version>-windows.zip   unzip, then "Install Neon Keys.cmd" (or "Neon Keys.cmd" to just run it)
#   neon-keys_<version>_all.deb       Ubuntu/Debian package
#   neon-keys-<version>-linux.tar.gz  any Linux: extract, then ./linux/install.sh
# Needs bash, tar, python3 and dpkg-deb. Run from anywhere; usage: scripts/build-release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
MAINTAINER="${MAINTAINER:-Infinimitsu <6240427+Infinimitsu@users.noreply.github.com>}"
DIST="$ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
rm -rf "$DIST"
mkdir -p "$DIST"

docs=("$ROOT/README.md" "$ROOT/LICENSE" "$ROOT/VERSION")

# ---- Windows zip ---------------------------------------------------------------------------
win="$STAGE/windows/Neon Keys"
mkdir -p "$win"
cp -r "$ROOT/web" "$win/web"
cp "$ROOT/windows/"{neon-keys.ps1,install.ps1,uninstall.ps1,neon-keys.ico,"Neon Keys.cmd","Install Neon Keys.cmd"} "$win/"
for f in "${docs[@]}"; do [ -f "$f" ] && cp "$f" "$win/"; done
python3 - "$STAGE/windows" "$DIST/neon-keys-$VERSION-windows.zip" <<'EOF'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for folder, _, files in os.walk(src):
        for name in sorted(files):
            path = os.path.join(folder, name)
            z.write(path, os.path.relpath(path, src))
EOF

# ---- Debian package ------------------------------------------------------------------------
deb="$STAGE/deb"
mkdir -p "$deb/DEBIAN" "$deb/opt/neon-keys" "$deb/usr/bin" "$deb/usr/share/applications" "$deb/usr/share/icons/hicolor/scalable/apps"
cp -r "$ROOT/web" "$deb/opt/neon-keys/web"
install -m 755 "$ROOT/linux/neon-keys" "$deb/opt/neon-keys/neon-keys"
ln -s /opt/neon-keys/neon-keys "$deb/usr/bin/neon-keys"
sed "s#@LAUNCHER@#/usr/bin/neon-keys#" "$ROOT/linux/neon-keys.desktop" > "$deb/usr/share/applications/neon-keys.desktop"
cp "$ROOT/web/icon.svg" "$deb/usr/share/icons/hicolor/scalable/apps/neon-keys.svg"
find "$deb/opt" "$deb/usr/share" -type d -exec chmod 755 {} +
find "$deb/opt/neon-keys/web" "$deb/usr/share" -type f -exec chmod 644 {} +
cat > "$deb/DEBIAN/control" <<EOF
Package: neon-keys
Version: $VERSION
Section: education
Priority: optional
Architecture: all
Depends: python3
Recommends: google-chrome-stable | chromium | chromium-browser
Maintainer: $MAINTAINER
Homepage: https://github.com/Infinimitsu/neon-keys
Description: Light-up piano visualizer and lessons for USB MIDI keyboards
 Plug in a MIDI keyboard and play: notes light up the screen over late-90s
 style visualizers. Includes built-in sounds, falling-note lessons with
 karaoke lyrics, songs imported from tabs, chord sheets or MIDI files, and a
 webcam music mode. Runs locally in Google Chrome or Chromium.
EOF
dpkg-deb --root-owner-group --build "$deb" "$DIST/neon-keys_${VERSION}_all.deb" >/dev/null

# ---- Generic Linux tarball -----------------------------------------------------------------
tgz="$STAGE/tgz/neon-keys-$VERSION"
mkdir -p "$tgz"
cp -r "$ROOT/web" "$ROOT/linux" "$tgz/"
for f in "${docs[@]}"; do [ -f "$f" ] && cp "$f" "$tgz/"; done
tar -C "$STAGE/tgz" -czf "$DIST/neon-keys-$VERSION-linux.tar.gz" "neon-keys-$VERSION"

(cd "$DIST" && sha256sum -- * > SHA256SUMS)
ls -l "$DIST"
