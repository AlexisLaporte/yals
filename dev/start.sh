#!/bin/bash
set -e
PORT=7000
cd "$(dirname "$0")/.."
echo "🚀 Démarrage FastAPI sur port ${PORT}"
unbuffer ./venv/bin/python -m uvicorn server.web.server:app --host 0.0.0.0 --port ${PORT} --reload 2>&1 | tee dev/dev.log
