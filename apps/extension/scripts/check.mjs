import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceDirectory = new URL('../src/', import.meta.url);
const sourceFiles = await readdir(sourceDirectory);
const javascriptFiles = sourceFiles
  .filter((file) => file.endsWith('.js'))
  .map((file) => fileURLToPath(new URL(`../src/${file}`, import.meta.url)));

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Checked ${javascriptFiles.length} JavaScript files`);
