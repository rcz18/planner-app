#!/bin/bash
# Planner Helper setup for Mac: lets the Planner app run Claude Code on this Mac.
# Run in Terminal:  curl -fsSL https://raw.githubusercontent.com/rcz18/planner-app/main/helper/setup-mac.sh | bash
# Run it again any time to update. Remove with:
#   curl -fsSL https://raw.githubusercontent.com/rcz18/planner-app/main/helper/uninstall-mac.sh | bash
set -euo pipefail
BASE='https://raw.githubusercontent.com/rcz18/planner-app/main/helper'
PORT=47321
LABEL='com.rcz18.planner-helper'
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

say()  { printf '%b\n' "$*"; }
ok()   { printf '  \033[32m[OK]\033[0m %s\n' "$*"; }
step() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\n  \033[31m[!] %s\033[0m\n\n' "$*"; exit 1; }

[ "$(uname -s)" = Darwin ] || die 'Para sa Mac lang ang setup na ito. Sa Windows, gamitin ang setup.ps1.'

say ''
say '\033[36m=== Planner Helper setup (Mac) ===\033[0m'
say 'Ikokonekta nito ang Planner app kay Claude Code sa Mac na ito.'
say ''

# Folder picker (a normal Mac window). Prints the chosen folder, or nothing if cancelled.
pick_folder() { # $1 = prompt, $2 = start folder
  local start="$2"; [ -d "$start" ] || start="$HOME"
  osascript - "$1" "$start" 2>/dev/null <<'OSA' || true
on run argv
  try
    set f to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))
    return POSIX path of f
  on error
    return ""
  end try
end run
OSA
}

# --- 1. where things go (you choose) ---
OLD_DIR=''; OLD_ROOT=''; OLD_MODEL=''
if [ -f "$PLIST" ]; then
  OLD_JS=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$PLIST" 2>/dev/null) || OLD_JS=''
  [ -n "$OLD_JS" ] && OLD_DIR=$(dirname "$OLD_JS")
fi
if [ -n "$OLD_DIR" ] && [ -f "$OLD_DIR/config.json" ]; then
  # plutil prints its errors on stdout, so a missing key must give an empty value, not the error text
  OLD_ROOT=$(/usr/bin/plutil -extract root raw -o - "$OLD_DIR/config.json" 2>/dev/null) || OLD_ROOT=''
  OLD_MODEL=$(/usr/bin/plutil -extract model raw -o - "$OLD_DIR/config.json" 2>/dev/null) || OLD_MODEL=''
  [ -d "$OLD_ROOT" ] || OLD_ROOT=''
  printf '%s' "$OLD_MODEL" | grep -Eq '^[A-Za-z0-9._:\[\]-]{1,80}$' || OLD_MODEL=''
fi
DEF_DIR=${OLD_DIR:-"$HOME/Library/Application Support/Planner Helper"}

step '1) Piliin kung SAAN ILALAGAY ang Planner Helper (may lalabas na window).'
say  '   Kung hindi ka sigurado, i-Cancel lang: mapupunta ito sa ~/Library/Application Support.'
PARENT=$(pick_folder 'Saan ilalagay ang Planner Helper? (gagawa ng folder na "Planner Helper" dito)' "$(dirname "$DEF_DIR")")
PARENT=${PARENT%/}
if [ -z "$PARENT" ]; then DIR="$DEF_DIR"
elif [ "$(basename "$PARENT")" = 'Planner Helper' ]; then DIR="$PARENT"
else DIR="$PARENT/Planner Helper"; fi
mkdir -p "$DIR/logs" || die "Hindi makagawa ng folder sa $DIR. Pumili ng ibang folder."
ok "Helper folder: $DIR"

DEF_ROOT="$OLD_ROOT"
if [ -z "$DEF_ROOT" ]; then
  for d in "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive/Video Production" "$HOME/Documents/Planner App" "$HOME/Documents"; do
    if [ -d "$d" ]; then DEF_ROOT="$d"; break; fi
  done
fi
step '2) Piliin ang PROJECTS FOLDER mo (kung nasaan ang mga .planner project).'
ROOT=$(pick_folder 'Piliin ang projects folder (dito lang puwedeng gumawa si Claude Code)' "${DEF_ROOT:-$HOME}")
ROOT=${ROOT%/}; [ -n "$ROOT" ] || ROOT="${DEF_ROOT:-$HOME/Documents}"
[ -d "$ROOT" ] || die "Wala ang folder na $ROOT."
ok "Projects folder: $ROOT"

# --- 2. Node.js (runs the helper). If there is none, a private copy goes inside the helper folder (no password needed). ---
NODE=''
for c in "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node "$DIR/node/bin/node"; do
  if [ -n "$c" ] && [ -x "$c" ] && "$c" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  say 'Dina-download ang Node.js (kailangan ng helper)...'
  case "$(uname -m)" in arm64) A=arm64 ;; *) A=x64 ;; esac
  NURL='https://nodejs.org/dist/latest-v22.x'
  SUMS=$(curl -fsSL "$NURL/SHASUMS256.txt") || die 'Hindi ma-download ang Node.js. Tingnan ang internet, tapos patakbuhin ulit ito.'
  LINE=$(printf '%s\n' "$SUMS" | grep " node-v[0-9.]*-darwin-$A.tar.gz\$" | head -1)
  [ -n "$LINE" ] || die 'Hindi mahanap ang Node.js para sa Mac na ito.'
  SUM=${LINE%% *}; FILE=${LINE##* }
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$NURL/$FILE" -o "$TMP/node.tgz" || die 'Hindi ma-download ang Node.js.'
  [ "$(shasum -a 256 "$TMP/node.tgz" | cut -d' ' -f1)" = "$SUM" ] || die 'Sira ang na-download na Node.js. Patakbuhin ulit ito.'
  tar -xzf "$TMP/node.tgz" -C "$TMP"
  rm -rf "$DIR/node"; mv "$TMP/${FILE%.tar.gz}" "$DIR/node"
  NODE="$DIR/node/bin/node"
fi
ok "Node.js: $NODE ($("$NODE" -v))"

# --- 3. Claude Code ---
find_claude() {
  for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude "$(command -v claude 2>/dev/null || true)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}
CLAUDE=$(find_claude || true)
if [ -z "$CLAUDE" ]; then
  say 'Ini-install ang Claude Code...'
  curl -fsSL https://claude.ai/install.sh | bash || true
  CLAUDE=$(find_claude || true)
  [ -n "$CLAUDE" ] || die 'Hindi ma-install ang Claude Code. Subukan ulit, o tingnan ang https://docs.claude.com/en/docs/claude-code'
fi
ok "Claude Code: $CLAUDE"

# --- 4. helper files + the planner skill for Claude Code ---
V=$(date +%s)
SRC=''; [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ] && SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$HOME/.claude/skills/planner"
if [ -n "$SRC" ] && [ -f "$SRC/helper.js" ] && [ -f "$SRC/SKILL.md" ]; then   # run from a downloaded folder
  cp "$SRC/helper.js" "$DIR/helper.js.new"; cp "$SRC/SKILL.md" "$HOME/.claude/skills/planner/SKILL.md"
else
  curl -fsSL "$BASE/helper.js?v=$V" -o "$DIR/helper.js.new" || die 'Hindi ma-download ang helper.'
  curl -fsSL "$BASE/SKILL.md?v=$V" -o "$HOME/.claude/skills/planner/SKILL.md" || die 'Hindi ma-download ang planner skill.'
fi
mv "$DIR/helper.js.new" "$DIR/helper.js"
"$NODE" -e 'const [f,root,port,claude,node,model]=process.argv.slice(1);const c={root,port:+port,claude,node};if(model)c.model=model;require("fs").writeFileSync(f,JSON.stringify(c,null,2))' \
  "$DIR/config.json" "$ROOT" "$PORT" "$CLAUDE" "$NODE" "$OLD_MODEL"
ok 'Helper at planner skill'

# --- 5. start with the Mac, quietly (no window) ---
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
UIDN=$(id -u)
launchctl bootout "gui/$UIDN/$LABEL" 2>/dev/null || true
pkill -f 'Planner Helper/helper.js' 2>/dev/null || true
mkdir -p "$HOME/Library/LaunchAgents"
PATHS="$(dirname "$CLAUDE"):$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$DIR/helper.js")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$PATHS")</string>
    <key>HOME</key><string>$(xml "$HOME")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$DIR/logs/launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$DIR/logs/launchd.log")</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null || die 'May mali sa startup file ng helper.'
launchctl bootstrap "gui/$UIDN" "$PLIST" || die 'Hindi masimulan ang helper.'
sleep 3
if ST=$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/status" 2>/dev/null); then
  ok "Helper running ($(printf '%s' "$ST" | sed -n 's/.*"helper":"\([^"]*\)".*/v\1/p'))"
else
  say '  \033[31m[!] Hindi pa sumasagot ang helper. I-restart ang Mac kung hindi ito gumana.\033[0m'
fi
say '  Kapag nagtanong ang Mac kung puwedeng buksan ng "node" ang mga file mo (Documents o Google Drive), piliin ang Allow.'

# --- 6. log in to Claude Code once ---
if ! grep -q '"oauthAccount"' "$HOME/.claude.json" 2>/dev/null; then
  say ''
  step 'Huling hakbang: mag-login kay Claude Code gamit ang Claude account mo (walang API).'
  step 'Bubukas si Claude Code dito. Piliin ang "Claude account with subscription", sundan ang login, tapos i-type ang /exit.'
  if [ -t 0 ]; then
    printf 'Pindutin ang Enter para magsimula '; read -r _ || true
    "$CLAUDE" || true
  else
    say "I-paste ito sa Terminal para mag-login: \033[36m$CLAUDE\033[0m  (tapos /exit)"
  fi
fi

say ''
say '\033[36m=== Tapos na! ===\033[0m'
say 'Buksan ang Planner app. Kapag nagtanong ang Chrome tungkol sa "local network" o "apps on this device", piliin ang Allow.'
say 'Ang Revise / Apply all changes / Export ay diretso na kay Claude Code.'
