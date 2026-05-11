#!/usr/bin/env bash
# Load R2 credentials from macOS Keychain and exec the next command.
#
# Why this exists: the parent shell may already export R2_* vars for other
# projects (e.g. ~/.zshenv loading a different bucket's keys). This script
# guarantees that this project always sees its own credentials, regardless
# of what the parent shell did.
#
# Secrets (always overwritten from Keychain):
#   R2_ACCESS_KEY_ID       <- HTML_EDITOR_R2_ACCESS_KEY_ID
#   R2_SECRET_ACCESS_KEY   <- HTML_EDITOR_R2_SECRET_ACCESS_KEY
#
# Shared with other projects (one Cloudflare account, one ID):
#   R2_ACCOUNT_ID          <- parent env, falling back to Keychain R2_ACCOUNT_ID
#
# Non-secret config (cleared here so .env.local always wins):
#   R2_BUCKET_NAME, R2_PUBLIC_URL
#
# If a Keychain entry is missing, the variable ends up empty and
# /api/upload-image returns 503 — local file editing still works.

kc() {
  /usr/bin/security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null
}

R2_ACCESS_KEY_ID="$(kc HTML_EDITOR_R2_ACCESS_KEY_ID)"
R2_SECRET_ACCESS_KEY="$(kc HTML_EDITOR_R2_SECRET_ACCESS_KEY)"
: "${R2_ACCOUNT_ID:=$(kc R2_ACCOUNT_ID)}"

export R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ACCOUNT_ID
unset R2_BUCKET_NAME R2_PUBLIC_URL

exec "$@"
