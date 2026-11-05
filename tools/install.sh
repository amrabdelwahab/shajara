#!/bin/sh
# Installs the shajara command and its Claude Code skill, then logs you into your space.
#   curl -fsSL https://amrabdelwahab.github.io/shajara/tools/install.sh | sh
set -e
BIN="${SHAJARA_BIN:-$HOME/.local/bin}"
SRC="https://amrabdelwahab.github.io/shajara/tools/shajara"
mkdir -p "$BIN"

# From a checkout (make install-cli) use the local copy, otherwise download it.
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
if [ -f "$HERE/shajara" ] && [ "$HERE/shajara" != "$BIN/shajara" ]; then
  cp "$HERE/shajara" "$BIN/shajara"
else
  curl -fsSL "$SRC" -o "$BIN/shajara"
fi
chmod +x "$BIN/shajara"
command -v python3 >/dev/null || { echo "shajara needs Python 3. Install it, then run this again."; exit 1; }
"$BIN/shajara" skill install

if ! "$BIN/shajara" whoami >/dev/null 2>&1; then
  printf "Your space's passcode: "; stty -echo < /dev/tty; read -r KEY < /dev/tty; stty echo < /dev/tty; echo
  printf "Your name in the space: "; read -r NAME < /dev/tty
  "$BIN/shajara" login "$KEY" --as "$NAME"
fi

case ":$PATH:" in
  *":$BIN:"*) echo "Done. Try: shajara set show <set>, or ask Claude \"show me our set in Shajara\"." ;;
  *) echo "Done. Claude can use it now. To type it yourself, add this to your shell profile:"
     echo "  export PATH=\"$BIN:\$PATH\"" ;;
esac
