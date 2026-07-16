#!/usr/bin/env bash
# Smoke test for H09AAPPLE-70 POC on Windows (run from spikes/electron-capture-poc).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -rf output
mkdir -p output

echo "Starting Electron POC (step 3) in background..."
VALIDATION_STEP=3 npm start > output/run.log 2>&1 &
PID=$!

cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if grep -q "uIOhook started" output/run.log 2>/dev/null; then
    break
  fi
  sleep 0.5
done

sleep 1

echo "Simulating global key press..."
powershell.exe -NoProfile -Command "
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Input {
  [DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@;
[Input]::keybd_event(0x41, 0, 0, [UIntPtr]::Zero);
Start-Sleep -Milliseconds 50;
[Input]::keybd_event(0x41, 0, 2, [UIntPtr]::Zero);
" >/dev/null

sleep 2

if [[ ! -f output/events.log ]]; then
  echo "FAIL: no output/events.log"
  cat output/run.log
  exit 1
fi

LINES=$(wc -l < output/events.log | tr -d ' ')
echo "events.log lines: $LINES"
cat output/events.log

SHOT_COUNT=$(find output/screenshots -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
echo "screenshots: $SHOT_COUNT"

if [[ "$LINES" -lt 1 ]]; then
  echo "FAIL: expected at least one logged event"
  exit 1
fi

echo "SMOKE_OK"
