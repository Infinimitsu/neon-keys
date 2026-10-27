#!/usr/bin/env bash
# Removes Neon Keys. Google Chrome is left installed.
# Usage: ./uninstall.sh [--system] [--keep-progress]
#   --system         remove the all-users install (asks for the password); everyone's progress is kept
#   --keep-progress  per-user: keep your profile with lesson stars
set -euo pipefail

SYSTEM=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --system) SYSTEM=1 ;;
    --keep-progress) KEEP=1 ;;
    *) echo "usage: $0 [--system] [--keep-progress]" >&2; exit 2 ;;
  esac
done

if [ "$SYSTEM" = 1 ]; then
  [ "$(id -u)" = 0 ] || exec sudo bash "$0" "$@"
  rm -rf /opt/neon-keys  # app files and the launcher
  rm -f /usr/local/bin/neon-keys /usr/share/applications/neon-keys.desktop /usr/share/icons/hicolor/scalable/apps/neon-keys.svg
  update-desktop-database /usr/share/applications 2>/dev/null || true
  gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
  echo "Neon Keys removed for all users (each user's progress is still in ~/.local/share/neon-keys)."
  exit 0
fi

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA/neon-keys"
rm -f "$HOME/.local/bin/neon-keys" \
      "$DATA/applications/neon-keys.desktop" \
      "$DATA/icons/hicolor/scalable/apps/neon-keys.svg"
update-desktop-database "$DATA/applications" 2>/dev/null || true

if [ "$KEEP" = 1 ]; then
  rm -rf "$APP_DIR/web"
  echo "Neon Keys removed (lesson progress kept in $APP_DIR/profile)."
else
  rm -rf "$APP_DIR"
  echo "Neon Keys removed."
fi
