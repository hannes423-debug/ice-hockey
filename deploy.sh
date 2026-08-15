#!/usr/bin/env bash
# Sync the working copies into deploy/ and (optionally) ship them.
#
# WHY THIS EXISTS
#   Three separate times, a finished feature was reported as "missing from the
#   GUI" when the code was fine and deploy/ was simply behind. The failure is
#   invisible by design: the stale file is COMMITTED, so `git status` in deploy/
#   is clean and nothing anywhere says the working copy moved on. The only
#   reliable signal is a content hash of every deployed file against its source.
#
#   So: never `cp` into deploy/ by hand again. `./deploy.sh` is the only path.
#
# USAGE
#   ./deploy.sh              check only — what is stale? copies nothing (default)
#   ./deploy.sh sync         copy sources in, verify hashes, stop before git
#   ./deploy.sh ship         sync + verify + commit + push
#   ./deploy.sh ship -m "…"  same, with your own commit subject
#
# `check` exits 1 when anything is stale, so it can gate: ./deploy.sh || ...
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The site used to be its own repo in deploy/. It is now the ROOT of this one,
# so "publishing" is copying the built file next to its own source and
# committing. The copy is still a copy and can still go stale or half-finish,
# which is the whole reason this script exists, so nothing else changes.
DEPLOY="$ROOT"

# ---------------------------------------------------------------- manifest --
# "source-relative-to-ROOT  ->  name-inside-deploy".
# The renames are the trap: game/ice_hockey.html is published as game.html, so
# an `ls` of the two folders never lines up and a missing file is not obvious.
# game.html is the 2.5D build as of 2026-08-13, NOT ice_hockey.html. That file
# is GENERATED (make25d.py re-derives it from ice_hockey.html every run), so run
# the chain in game/TWOFIVED_PROTOTYPE.md before shipping or you publish a
# prototype built from a stale base — which is the exact failure this script
# exists to catch, one level further up.
MANIFEST=(
  "game/ice_hockey_25d.html                game.html"
  "customizer/ice-hockey-customize-app.js  ice-hockey-customize-app.js"
  "customizer/ice-hockey-customize-core.js ice-hockey-customize-core.js"
  "customizer/ice-hockey-customize-data.js ice-hockey-customize-data.js"
  "customizer/ice-hockey-customize.html    ice-hockey-customize.html"
  "customizer/fullscreen.js                fullscreen.js"
)

# Tracked files that live ONLY in deploy/ — they have no upstream copy, so they
# are edited in place and this script must never touch them. Listed so that a
# file appearing in deploy/ and in neither list gets flagged rather than
# silently ignored.
DEPLOY_ONLY=(index.html style.css script.js menu-player.js README.md .gitignore
             img/locker-room.jpg)

# Source files that happen to sit at the root. Since the merge, the root holds
# both the published site AND project-level source, so "a root-level file in
# neither list" is no longer automatically a mistake. These are not published;
# GitHub Pages will serve them, but nothing links to them.
ROOT_SOURCE=(deploy.sh MOVE-MANIFEST.txt)

# ------------------------------------------------------------------- colour --
if [ -t 1 ]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; X=$'\e[0m'
else R=; G=; Y=; B=; X=; fi

MODE="${1:-check}"; shift || true
MSG=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$MODE" in check|sync|ship) ;; *) sed -n '2,20p' "$0"; exit 2 ;; esac

[ -d "$DEPLOY/.git" ] || { echo "${R}$DEPLOY is not a git repo${X}" >&2; exit 1; }

h(){ md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

# ------------------------------------------------------------------- check --
# Always runs first, in every mode, BEFORE anything is copied — so `check` and
# the first half of `ship` print the identical report.
echo "${B}source -> deploy${X}"
STALE=(); MISSING=()
for row in "${MANIFEST[@]}"; do
  src="${row%% *}"; dst="${row##* }"
  s="$ROOT/$src"; d="$DEPLOY/$dst"
  if [ ! -f "$s" ]; then
    printf '  %-42s %sSOURCE MISSING%s\n' "$src" "$R" "$X"; MISSING+=("$src"); continue
  fi
  if [ "$(h "$s")" = "$(h "$d")" ]; then
    printf '  %-42s %sup to date%s\n' "$dst" "$G" "$X"
  else
    # mtime is a HINT for reading the report, never the test — a file can be
    # newer and still stale content. The hash above already decided.
    if [ -f "$d" ]; then when="deploy $(date -r "$d" '+%m-%d %H:%M') · source $(date -r "$s" '+%m-%d %H:%M')"
    else when="not in deploy/"; fi
    printf '  %-42s %sSTALE%s  (%s)\n' "$dst" "$Y" "$X" "$when"
    STALE+=("$row")
  fi
done

[ ${#MISSING[@]} -gt 0 ] && { echo "${R}aborting: a manifest source does not exist${X}"; exit 1; }

# Deploy-only files can't be hash-checked, but they CAN be sitting uncommitted
# and get forgotten — which loses work the same way. Surface them.
UNCOMMITTED=$(cd "$DEPLOY" && git status --porcelain -- "${DEPLOY_ONLY[@]}" 2>/dev/null)
if [ -n "$UNCOMMITTED" ]; then
  echo "${B}deploy-only files with uncommitted edits${X} (no upstream copy — edited in place)"
  echo "$UNCOMMITTED" | sed 's/^/  /'
fi

# Anything tracked in deploy/ that neither list accounts for. A new file added
# to the site without being added here would otherwise never be synced.
# Only root-level files are the published surface; everything in a subfolder
# is source. Before the merge this same filter existed for a different reason
# and silently skipped tests/ — now it is the correct rule rather than a
# coincidence.
UNACCOUNTED=$(cd "$DEPLOY" && git ls-files | grep -v '/' | while read -r f; do
  for row in "${MANIFEST[@]}"; do [ "${row##* }" = "$f" ] && continue 2; done
  for o in "${DEPLOY_ONLY[@]}";  do [ "$o" = "$f" ]         && continue 2; done
  for o in "${ROOT_SOURCE[@]}";  do [ "$o" = "$f" ]         && continue 2; done
  echo "$f"
done)
[ -n "$UNACCOUNTED" ] && {
  echo "${Y}published at the root but in no list — add it to MANIFEST or DEPLOY_ONLY${X}"
  echo "$UNACCOUNTED" | sed 's/^/  /'; }

if [ "$MODE" = check ]; then
  if [ ${#STALE[@]} -eq 0 ]; then echo "${G}the published files match their sources${X}"; exit 0; fi
  # Non-zero on stale so it can gate something: `./deploy.sh || ./deploy.sh ship`
  echo "${Y}${#STALE[@]} file(s) stale — run ./deploy.sh sync${X}"; exit 1
fi

# -------------------------------------------------------------------- sync --
if [ ${#STALE[@]} -eq 0 ]; then
  echo "${G}nothing to copy${X}"
else
  echo "${B}copying${X}"
  for row in "${STALE[@]}"; do
    src="${row%% *}"; dst="${row##* }"
    cp -- "$ROOT/$src" "$DEPLOY/$dst" || { echo "${R}cp failed: $src${X}" >&2; exit 1; }
    echo "  $src -> deploy/$dst"
  done
fi

# Re-hash EVERYTHING, not just what we copied. This is the whole point of the
# script: a half-finished copy, a full disk or a stray editor write must fail
# loudly here rather than become a committed, clean-looking stale file.
echo "${B}verifying${X}"
FAIL=0
for row in "${MANIFEST[@]}"; do
  src="${row%% *}"; dst="${row##* }"
  if [ "$(h "$ROOT/$src")" = "$(h "$DEPLOY/$dst")" ]; then
    printf '  %-42s %sok%s\n' "$dst" "$G" "$X"
  else
    printf '  %-42s %sHASH MISMATCH%s\n' "$dst" "$R" "$X"; FAIL=1
  fi
done
[ $FAIL -eq 0 ] || { echo "${R}verification failed — nothing committed${X}" >&2; exit 1; }

# Cheap guard against shipping a build that cannot even parse. A syntax error in
# app.js presents to the user as "the editor is gone", not as an error.
if command -v node >/dev/null 2>&1; then
  echo "${B}syntax${X}"
  for f in "$DEPLOY"/*.js; do
    if node --check "$f" 2>/dev/null; then printf '  %-42s %sok%s\n' "$(basename "$f")" "$G" "$X"
    else printf '  %-42s %sPARSE ERROR%s\n' "$(basename "$f")" "$R" "$X"; FAIL=1; fi
  done
  [ $FAIL -eq 0 ] || { echo "${R}a deployed script does not parse — nothing committed${X}" >&2; exit 1; }
fi

[ "$MODE" = sync ] && { echo "${G}published files are in sync — not committed${X}"; exit 0; }

# -------------------------------------------------------------------- ship --
cd "$DEPLOY" || exit 1
# Stage by explicit path. `git add -A` here would sweep in the .bak_pre_* files
# that live alongside the real ones.
for row in "${MANIFEST[@]}"; do git add -- "${row##* }"; done
git add -- "${DEPLOY_ONLY[@]}" 2>/dev/null

if git diff --cached --quiet; then
  echo "${G}nothing staged — already shipped${X}"
  git log --oneline -1; exit 0
fi

echo "${B}staged${X}"; git diff --cached --stat | sed 's/^/  /'

[ -n "$MSG" ] || MSG="Sync deploy/ with the working copies"
git commit -q -m "$MSG" -m "Files synced and md5-verified against their sources by deploy.sh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" || exit 1

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH" || { echo "${R}push failed — commit is local${X}" >&2; exit 1; }
echo "${G}shipped${X}  $(git log --oneline -1)"
