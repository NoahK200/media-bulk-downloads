/* global URL, console, process */
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const executable = resolve(repo, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
const run = spawnSync(process.execPath, [executable,
  'lint', '--source-dir', 'apps/extension/.output/firefox-mv3', '--output', 'json', '--no-config-discovery',
], { cwd: repo, encoding: 'utf8' });
if (run.error) throw run.error;
let report;
try { report = JSON.parse(run.stdout); }
catch { throw new Error(run.stderr || run.stdout || 'Firefox lint did not return JSON.'); }
if (report.summary?.errors || run.status !== 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  const exceptions = JSON.parse(await readFile(new URL('../release-exceptions.json', import.meta.url), 'utf8')).firefoxWarnings ?? [];
  const usage = new Map(exceptions.map((entry) => [entry, 0]));
  const unapproved = [];
  for (const warning of report.warnings ?? []) {
    const match = exceptions.find((entry) => entry.code === warning.code
      && new RegExp(entry.filePattern).test(warning.file)
      && Date.parse(entry.expires) > Date.now()
      && usage.get(entry) < entry.maxCount);
    if (!match) unapproved.push(warning);
    else usage.set(match, usage.get(match) + 1);
  }
  const stale = exceptions.filter((entry) => usage.get(entry) !== entry.maxCount);
  if (unapproved.length || stale.length) {
    if (unapproved.length) console.error('Unapproved Firefox warnings:', JSON.stringify(unapproved, null, 2));
    if (stale.length) console.error('Stale or count-mismatched Firefox allowlist:', JSON.stringify(stale, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Firefox lint: 0 errors, ${report.summary.warnings} approved warning(s), 0 unapproved warnings.`);
  }
}
