#!/bin/zsh
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
LOG_DIR="$ROOT_DIR/logs"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
CERT_FILE="$BACKEND_DIR/certs/localhost.pem"
KEY_FILE="$BACKEND_DIR/certs/localhost-key.pem"
PID_FILE="$LOG_DIR/pids.txt"

mkdir -p "$LOG_DIR"
: > "$PID_FILE"

start_proc() {
  local name="$1"
  local logfile="$2"
  shift 2
  ("$@") > "$logfile" 2>&1 &
  local pid=$!
  echo "$name $pid" >> "$PID_FILE"
  echo "Started $name (pid=$pid) -> $logfile"
}

start_proc "backend_http" "$LOG_DIR/backend-8000.log" zsh -c "cd '$BACKEND_DIR' && source .venv/bin/activate && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
  start_proc "backend_https" "$LOG_DIR/backend-8443.log" zsh -c "cd '$BACKEND_DIR' && source .venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8443 --ssl-certfile '$CERT_FILE' --ssl-keyfile '$KEY_FILE'"
else
  echo "WARN: HTTPS用の証明書が見つかりません。" >&2
  echo "      $CERT_FILE" >&2
  echo "      $KEY_FILE" >&2
  echo "      スマホ撮影の枠表示を使う場合は mkcert の手順を実行してください。" >&2
fi

start_proc "frontend" "$LOG_DIR/frontend.log" zsh -c "cd '$FRONTEND_DIR' && npm start"

echo "\nPID一覧: $PID_FILE"
sleep 1
open "http://localhost:3000"
