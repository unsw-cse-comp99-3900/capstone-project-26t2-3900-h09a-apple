const { spawnSync } = require('child_process');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-rebuild', '-f', '-w', 'uiohook-napi'],
  { stdio: 'inherit', shell: true },
);

if (result.status !== 0) {
  console.warn(
    '\n[WARN] electron-rebuild for uiohook-napi failed. If `npm start` crashes on uiohook, install the Visual Studio "Desktop development with C++" workload, then run:\n  npx electron-rebuild -f -w uiohook-napi\n',
  );
  process.exit(0);
}
