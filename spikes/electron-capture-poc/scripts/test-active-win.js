const aw = require('active-win');

try {
  const win = aw.sync();
  console.log('ACTIVE_WIN_OK', win?.owner?.name, win?.title);
  process.exit(0);
} catch (error) {
  console.error('ACTIVE_WIN_FAIL', error.message);
  process.exit(1);
}
