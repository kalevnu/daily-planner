#!/usr/bin/env bash
# Makes sure TAURI_SIGNING_PRIVATE_KEY is the updater key the app trusts
# before a release is built, so a bad secret fails here with a clear message
# instead of after a 6-minute build (or worse, after an unusable release).
#
# GitHub stores a secret exactly as pasted, so stray whitespace or a key pasted
# twice is forgiven: the first 348 characters are the key tauri generated.
# Whatever survives is signed with and checked against the app's pubkey, and
# only then handed to the build through $GITHUB_ENV (when running in Actions).
set -euo pipefail
cd "$(dirname "$0")/.."

key="$(printf '%s' "${TAURI_SIGNING_PRIVATE_KEY:-}" | tr -d '[:space:]')"
if [ -z "$key" ]; then
  echo "::error::TAURI_SIGNING_PRIVATE_KEY secret is empty. Paste the content of updater-key/TAURI_SIGNING_PRIVATE_KEY.txt."
  exit 1
fi
is_base64() { python3 -c 'import base64,sys; base64.b64decode(sys.argv[1], validate=True)' "$1" >/dev/null 2>&1; }
if ! is_base64 "$key" && is_base64 "${key:0:348}"; then
  echo "secret has extra content after the key (length ${#key}); using its first 348 characters"
  key="${key:0:348}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "release check" > "$tmp/probe"
# Same env var `tauri build` reads, so this exercises exactly what the build will do.
if ! TAURI_SIGNING_PRIVATE_KEY="$key" npx tauri signer sign --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" "$tmp/probe" >"$tmp/sign.log" 2>&1; then
  grep -i error "$tmp/sign.log" || true
  echo "::error::TAURI_SIGNING_PRIVATE_KEY is not a usable tauri private key. Re-paste the 348-character content of updater-key/TAURI_SIGNING_PRIVATE_KEY.txt (nothing before or after it)."
  exit 1
fi

pubkey="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")"
if ! python3 scripts/verify-signature.py "$pubkey" "$tmp/probe" "$tmp/probe.sig"; then
  echo "::error::TAURI_SIGNING_PRIVATE_KEY does not match plugins.updater.pubkey in tauri.conf.json. Installed apps would refuse updates signed with it."
  exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "::add-mask::$key"
  echo "TAURI_SIGNING_PRIVATE_KEY=$key" >> "$GITHUB_ENV"
fi
echo "signing key OK"
