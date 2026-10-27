#!/usr/bin/env bash
# Installs Neon Keys: copies the app, adds the launcher and an app-menu icon, and offers to install
# Google Chrome if there's no browser to run it in. Run it again to update; lesson progress is kept
# (it lives in each user's own ~/.local/share/neon-keys/profile either way).
# Usage: ./install.sh [--system] [--yes]
#   --system  install for every user on this computer (asks for the password)
#   --yes     install Chrome without asking
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_WEB="$HERE/../web"
SYSTEM=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --system) SYSTEM=1 ;;
    --yes) ASSUME_YES=1 ;;
    *) echo "usage: $0 [--system] [--yes]" >&2; exit 2 ;;
  esac
done

if [ "$SYSTEM" = 1 ]; then
  [ "$(id -u)" = 0 ] || exec sudo bash "$0" "$@"
  APP_DIR=/opt/neon-keys
  BIN_DIR=/usr/local/bin
  ICON_DIR=/usr/share/icons/hicolor/scalable/apps
  DESKTOP_DIR=/usr/share/applications
else
  DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
  APP_DIR="$DATA/neon-keys"
  BIN_DIR="$HOME/.local/bin"
  ICON_DIR="$DATA/icons/hicolor/scalable/apps"
  DESKTOP_DIR="$DATA/applications"
fi

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

[ -f "$SRC_WEB/index.html" ] || { echo "Can't find the app files at $SRC_WEB" >&2; exit 1; }
command -v python3 >/dev/null || { echo "Neon Keys needs python3: sudo apt install python3" >&2; exit 1; }

say "Copying Neon Keys to $APP_DIR"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/web"  # replace the app files; a per-user install's profile next to it is kept
cp -r "$SRC_WEB" "$APP_DIR/web"
if [ "$SYSTEM" = 1 ]; then
  chmod -R a+rX "$APP_DIR"
  # The admin who ran this owns the app files, so updates can be copied in without sudo.
  [ -n "${SUDO_USER:-}" ] && chown -R "$SUDO_USER" "$APP_DIR/web"
fi

say "Installing the launcher as $BIN_DIR/neon-keys"
mkdir -p "$BIN_DIR"
if [ "$SYSTEM" = 1 ]; then
  # The launcher lives with the app files (owned by the admin, like web/) and is linked into the
  # PATH, so launcher fixes can be copied in later without sudo too.
  install -m 755 "$HERE/neon-keys" "$APP_DIR/neon-keys"
  [ -n "${SUDO_USER:-}" ] && chown "$SUDO_USER" "$APP_DIR/neon-keys"
  ln -sfn "$APP_DIR/neon-keys" "$BIN_DIR/neon-keys"
else
  install -m 755 "$HERE/neon-keys" "$BIN_DIR/neon-keys"
fi

say "Adding Neon Keys to the app menu"
mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
install -m 644 "$SRC_WEB/icon.svg" "$ICON_DIR/neon-keys.svg"
sed "s#@LAUNCHER@#$BIN_DIR/neon-keys#" "$HERE/neon-keys.desktop" > "$DESKTOP_DIR/neon-keys.desktop"
chmod 644 "$DESKTOP_DIR/neon-keys.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
[ "$SYSTEM" = 1 ] && { gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true; }

browser=""
for b in google-chrome google-chrome-stable chromium chromium-browser; do
  if path=$(command -v "$b"); then browser=$path; break; fi
done

if [ -z "$browser" ]; then
  if [ "$(dpkg --print-architecture)" != "amd64" ]; then
    warn "Google Chrome only runs on 64-bit PCs, and this one is $(dpkg --print-architecture). Neon Keys can't run here."
    exit 1
  fi
  answer=y
  if [ "$ASSUME_YES" = 0 ]; then
    read -rp "Neon Keys runs inside Google Chrome, which isn't installed. Download and install it now? [Y/n] " answer
  fi
  if [[ "${answer:-y}" =~ ^[Nn] ]]; then
    warn "Skipped Chrome. Neon Keys won't open until Chrome is installed (run this installer again)."
  else
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    say "Downloading Google Chrome"
    if command -v wget >/dev/null; then
      wget -q --show-progress -O "$tmp/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    else
      curl -fL --progress-bar -o "$tmp/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    fi
    chmod 644 "$tmp/chrome.deb" && chmod 755 "$tmp"  # apt reads the file as its own sandbox user
    say "Installing Google Chrome (asks for this computer's password)"
    sudo apt-get install -y "$tmp/chrome.deb"
  fi
elif [[ "$(basename "$browser")" == chromium* ]] && [ -e /snap/bin/chromium ]; then
  warn "Found the Snap version of Chromium. Snap apps sometimes can't see MIDI keyboards;"
  warn "if Neon Keys says 'no keyboard' with it plugged in, install Google Chrome instead."
fi

if command -v amidi >/dev/null && amidi -l 2>/dev/null | grep -q 'USB DEVIC'; then
  say "The Donner keyboard is plugged in and Ubuntu can see it."
else
  say "No keyboard detected right now - that's fine, Neon Keys finds it whenever it's plugged in."
fi

[ "$SYSTEM" = 1 ] && say "Installed for every user on this computer."
say "Done! Open 'Neon Keys' from the app menu (you can right-click it there to pin it to the dock)."
say "The first time it opens, tap 'Allow' when it asks to use MIDI devices."
