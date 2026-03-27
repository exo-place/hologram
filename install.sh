#!/usr/bin/env sh
# Hologram quickstart installer
# Usage: curl -fsSL https://exo.place/hologram/install.sh | sh
set -eu

REPO="https://github.com/exo-place/hologram"
DEST="${HOLOGRAM_DIR:-hologram}"

# ── Helpers ────────────────────────────────────────────────────────────────────
bold()  { printf '\033[1m%s\033[0m' "$1"; }
dim()   { printf '\033[2m%s\033[0m' "$1"; }
green() { printf '\033[32m%s\033[0m' "$1"; }
cyan()  { printf '\033[36m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }

ok()   { printf '%s %s\n' "$(green '✓')" "$1"; }
fail() { printf '%s %s\n' "$(red '✗')" "$1"; exit 1; }

prompt() {
  # $1 = label, $2 = hint (optional)
  if [ -n "${2:-}" ]; then
    printf '%s %s %s ' "$(cyan '?')" "$1" "$(dim "$2")";
  else
    printf '%s %s ' "$(cyan '?')" "$1"
  fi
}

# Detect whether we can prompt (not being piped)
if [ -t 0 ] && [ -t 1 ]; then
  INTERACTIVE=1
else
  INTERACTIVE=0
fi

# ── Dependencies ───────────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || fail "git is required — https://git-scm.com/"

if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | sh
  # Load bun into current shell
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || fail "Bun installation failed — try installing manually: https://bun.sh"
ok "Bun $(bun --version)"

# ── Clone / update ─────────────────────────────────────────────────────────────
if [ -d "$DEST/.git" ]; then
  echo "Updating existing install in ./$DEST"
  git -C "$DEST" pull --ff-only || true
else
  echo "Cloning hologram into ./$DEST"
  git clone "$REPO" "$DEST"
fi
cd "$DEST"

# ── Install + build ────────────────────────────────────────────────────────────
bun install --frozen-lockfile
bun run build
ok "Built"

# ── Configure ──────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  echo ".env already exists — skipping configuration"
else
  # Start from a known-good minimal config
  DISCORD_TOKEN=""
  DISCORD_APP_ID=""
  GOOGLE_KEY=""

  if [ "$INTERACTIVE" = "1" ]; then
    echo ""
    echo "$(bold 'Configure hologram') $(dim '(press Enter to skip any field)')"
    echo ""

    prompt "Google AI API key" "(free at aistudio.google.com/api-keys):"
    read -r GOOGLE_KEY || true

    prompt "Discord bot token" "(optional — skip to run in web-only mode):"
    read -r DISCORD_TOKEN || true

    if [ -n "$DISCORD_TOKEN" ]; then
      prompt "Discord application ID" "(from discord.com/developers/applications):"
      read -r DISCORD_APP_ID || true
    fi
  else
    echo ""
    echo "$(dim 'Non-interactive mode — creating .env with empty values.')"
    echo "$(dim 'Edit .env before running hologram.')"
  fi

  cat > .env << EOF
# Hologram configuration
# Full reference: .env.example

DISCORD_TOKEN=$DISCORD_TOKEN
DISCORD_APP_ID=$DISCORD_APP_ID

DEFAULT_MODEL=google:gemini-3-flash-preview
GOOGLE_GENERATIVE_AI_API_KEY=$GOOGLE_KEY
EOF

  ok ".env created"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "$(green "$(bold 'hologram is ready!')")"
echo ""
echo "  $(dim 'cd') $DEST"
echo "  $(dim 'Start:')    $(bold 'bun start')         $(dim '# production')"
echo "  $(dim 'Dev:')      $(bold 'bun run dev')       $(dim '# with watch + hot reload')"
echo "  $(dim 'Web UI:')   $(bold 'http://localhost:3000')"
echo ""
if [ -z "$(grep 'GOOGLE_GENERATIVE_AI_API_KEY=.' .env 2>/dev/null || true)" ] && \
   [ -z "$(grep 'ANTHROPIC_API_KEY=.' .env 2>/dev/null || true)" ] && \
   [ -z "$(grep 'OPENAI_API_KEY=.' .env 2>/dev/null || true)" ]; then
  echo "  $(dim 'Add at least one LLM API key to .env before starting.')"
  echo "  $(dim 'See .env.example for all supported providers.')"
  echo ""
fi
