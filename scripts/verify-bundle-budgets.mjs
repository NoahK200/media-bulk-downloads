/* global URL, console, process */
import { stat } from 'node:fs/promises';

const root = new URL('../apps/extension/.output/', import.meta.url);
const KiB = 1024;
const budgets = [
  ['chrome-mv3', 'content-scripts/sniffer-relay.js', 100 * KiB],
  ['firefox-mv3', 'content-scripts/sniffer-relay.js', 100 * KiB],
  ['edge-mv3', 'content-scripts/sniffer-relay.js', 100 * KiB],
  ['safari-mv3', 'content-scripts/sniffer-relay.js', 100 * KiB],
  ['chrome-mv3', 'content-scripts/content.js', 400 * KiB],
  ['edge-mv3', 'content-scripts/content.js', 400 * KiB],
  ['firefox-mv3', 'content-scripts/content.js', 550 * KiB],
  ['safari-mv3', 'content-scripts/content.js', 550 * KiB],
];

let failed = false;
for (const [target, file, limit] of budgets) {
  try {
    const { size } = await stat(new URL(`${target}/${file}`, root));
    if (size > limit) {
      failed = true;
      console.error(`${target}/${file}: ${(size / KiB).toFixed(1)} KiB exceeds ${(limit / KiB).toFixed(0)} KiB`);
    } else {
      console.log(`${target}/${file}: ${(size / KiB).toFixed(1)} KiB / ${(limit / KiB).toFixed(0)} KiB`);
    }
  } catch (error) {
    failed = true;
    console.error(`${target}/${file}: missing (${error instanceof Error ? error.message : error})`);
  }
}
if (failed) process.exitCode = 1;
