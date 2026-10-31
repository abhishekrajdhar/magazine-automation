#!/usr/bin/env bash
# Syntax-check the ExtendScript files and the UXP panel JavaScript with `node --check`.
# Node refuses the .jsx extension, so the .jsx files are fed through stdin.
# Optional strict ES3 parse: set ACORN_DIR to a folder containing node_modules/acorn.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
for f in extendscript/*.jsx uxp/jsx/*.jsx; do
  [ -f "$f" ] || continue
  if node --check < "$f"; then echo "ok    node --check $f"; else echo "FAIL  node --check $f"; status=1; fi
  if LC_ALL=C grep -n '[^ -~	]' "$f" >/dev/null; then echo "FAIL  $f contains non-ASCII characters"; status=1; fi
done
for f in uxp/main.js uxp/lib/*.js tests/js/*.js; do
  if node --check "$f"; then echo "ok    node --check $f"; else echo "FAIL  node --check $f"; status=1; fi
done
if ! cmp -s extendscript/pressflow-render.jsx uxp/jsx/pressflow-render.jsx; then
  echo "FAIL  uxp/jsx/pressflow-render.jsx is out of date (run: make uxp-sync)"; status=1
fi
if [ -n "${ACORN_DIR:-}" ]; then
  for f in extendscript/*.jsx; do
    if NODE_PATH="$ACORN_DIR/node_modules" node -e 'require("acorn").parse(require("fs").readFileSync(process.argv[1],"utf8"),{ecmaVersion:3,allowReserved:false})' "$f"; then
      echo "ok    ES3 parse (acorn, reserved words disallowed) $f"
    else
      echo "FAIL  ES3 parse $f"; status=1
    fi
  done
fi
exit $status
