import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const venvPython = path.join(
  apiRoot,
  '.venv',
  isWin ? 'Scripts' : 'bin',
  isWin ? 'python.exe' : 'python',
);

if (!existsSync(venvPython)) {
  console.error(
    `Missing API venv python at ${venvPython}\n` +
      'Create it: python -m venv .venv && .venv/Scripts/pip install -r requirements.txt',
  );
  process.exit(1);
}

const child = spawn(
  venvPython,
  ['-m', 'uvicorn', 'app.main:app', '--reload', '--host', '0.0.0.0', '--port', '8000'],
  { cwd: apiRoot, stdio: 'inherit', env: process.env },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
