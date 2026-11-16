#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
if [ ! -d web/node_modules ]; then
  (cd web && npm ci)
fi
if [ ! -f web/dist/index.html ]; then
  (cd web && npm run build)
fi
exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8018
