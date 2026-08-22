/* global URL, console, process */
import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const extension = JSON.parse(await readFile(new URL('../apps/extension/package.json', import.meta.url), 'utf8'));

if (root.version !== extension.version) {
  console.error(`Version mismatch: root=${root.version}, extension=${extension.version}`);
  process.exitCode = 1;
}
