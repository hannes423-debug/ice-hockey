#!/usr/bin/env bash
# Fill xbox/IceHockeyXbox/GameLocal/ with the published site, for LOCAL mode.
#
# WHY THIS EXISTS, AND WHY IT DOES NOT KEEP ITS OWN FILE LIST
#   Three separate times in this project a finished feature was reported as
#   "missing from the GUI" when the code was fine and a hand-maintained copy
#   was simply behind (see ../../deploy.sh, which was written for that). A
#   bundled copy inside an appx is the same trap with a slower feedback loop:
#   the console shows a build from last week and nothing anywhere says so.
#
#   So the file list is NOT written here. It is read from package.json's
#   `build.files` — the list electron-builder already uses to decide what the
#   desktop app contains. One list, two wrappers: a file added to the site for
#   Electron is automatically in the Xbox package too, and a file forgotten is
#   forgotten in both places at once, loudly, instead of in one place quietly.
#
#   Every copied file is then md5-verified, same as deploy.sh, so a half-copy
#   or a full disk fails here rather than becoming a package that boots to a
#   black screen on a TV.
#
# USAGE
#   xbox/tools/sync-local.sh          copy + verify   (npm run xbox:sync)
#   xbox/tools/sync-local.sh check    report only, exits 1 if anything is stale
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="$ROOT/xbox/IceHockeyXbox/GameLocal"
MODE="${1:-sync}"
case "$MODE" in sync|check) ;; *) sed -n '2,25p' "$0"; exit 2 ;; esac

if [ -t 1 ]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; X=$'\e[0m'
else R=; G=; Y=; B=; X=; fi

command -v python3 >/dev/null || { echo "${R}python3 is required${X}" >&2; exit 1; }

# ---- the file list, expanded from package.json's electron-builder globs -----
# package.json is authoritative; this only turns its globs into paths and drops
# the ones that are not part of the running site (package.json itself, and
# electron/, which the Xbox host obviously does not need).
FILES=$(cd "$ROOT" && python3 - <<'PY'
import json, glob, os, sys

spec = json.load(open("package.json"))["build"]["files"]
skip_prefixes = ("electron/",)
skip_exact = {"package.json"}

out = []
for pat in spec:
    hits = [h for h in glob.glob(pat, recursive=True) if os.path.isfile(h)]
    if not hits:
        print("MISSING\t" + pat, file=sys.stderr)
    out += hits

seen = set()
for f in sorted(out):
    f = f.replace(os.sep, "/")
    if f in skip_exact or f.startswith(skip_prefixes) or f in seen:
        continue
    seen.add(f)
    print(f)
PY
) || { echo "${R}could not read package.json${X}" >&2; exit 1; }

[ -n "$FILES" ] || { echo "${R}package.json build.files expanded to nothing${X}" >&2; exit 1; }

h(){ md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

# ---------------------------------------------------------------- check ------
echo "${B}site -> xbox/IceHockeyXbox/GameLocal${X}"
STALE=(); N=0
while IFS= read -r f; do
  N=$((N+1))
  if [ "$(h "$ROOT/$f")" = "$(h "$DEST/$f")" ]; then
    [ "$MODE" = check ] && printf '  %-44s %sup to date%s\n' "$f" "$G" "$X"
  else
    printf '  %-44s %sSTALE%s\n' "$f" "$Y" "$X"
    STALE+=("$f")
  fi
done <<< "$FILES"

# Anything in GameLocal/ that the site no longer has. A file deleted from the
# site but left in the bundle is how a package keeps shipping code that no
# longer exists anywhere else.
ORPHANS=()
if [ -d "$DEST" ]; then
  while IFS= read -r f; do
    grep -Fxq "$f" <<< "$FILES" || ORPHANS+=("$f")
  done < <(cd "$DEST" && find . -type f | sed 's|^\./||' | sort)
fi

if [ "$MODE" = check ]; then
  [ ${#ORPHANS[@]} -gt 0 ] && { echo "${Y}in the bundle but not on the site:${X}"; printf '  %s\n' "${ORPHANS[@]}"; }
  if [ ${#STALE[@]} -eq 0 ] && [ ${#ORPHANS[@]} -eq 0 ]; then
    echo "${G}the bundled copy matches the site ($N files)${X}"; exit 0
  fi
  echo "${Y}${#STALE[@]} stale, ${#ORPHANS[@]} orphaned — run xbox/tools/sync-local.sh${X}"; exit 1
fi

# ----------------------------------------------------------------- sync ------
for f in "${ORPHANS[@]:-}"; do
  [ -n "$f" ] || continue
  rm -f -- "$DEST/$f" && echo "  ${R}removed${X} $f (no longer on the site)"
done

if [ ${#STALE[@]} -eq 0 ]; then
  echo "${G}nothing to copy${X}"
else
  for f in "${STALE[@]}"; do
    mkdir -p "$(dirname "$DEST/$f")"
    cp -- "$ROOT/$f" "$DEST/$f" || { echo "${R}cp failed: $f${X}" >&2; exit 1; }
  done
  echo "  copied ${#STALE[@]} file(s)"
fi

# Re-hash EVERYTHING, not only what was copied — the point of the script.
FAIL=0
while IFS= read -r f; do
  [ "$(h "$ROOT/$f")" = "$(h "$DEST/$f")" ] || { printf '  %-44s %sHASH MISMATCH%s\n' "$f" "$R" "$X"; FAIL=1; }
done <<< "$FILES"
[ $FAIL -eq 0 ] || { echo "${R}verification failed — the bundle is not trustworthy${X}" >&2; exit 1; }

BYTES=$(du -sh "$DEST" 2>/dev/null | cut -f1)
echo "${G}bundled copy verified against the site${X}  $N files, $BYTES"
echo "Build the Xbox package in Visual Studio to pick it up (see xbox/README.md)."
