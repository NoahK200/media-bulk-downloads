/* global URL, console, process */
import { readFile } from 'node:fs/promises';

const root = new URL('../apps/extension/.output/', import.meta.url);
const targets = ['chrome-mv3', 'firefox-mv3', 'edge-mv3', 'safari-mv3'];
let failed = false;
for (const target of targets) {
  const manifest = JSON.parse(await readFile(new URL(`${target}/manifest.json`, root), 'utf8'));
  const permissions = new Set(manifest.permissions ?? []);
  const optional = new Set(manifest.optional_permissions ?? []);
  const check = (condition, message) => {
    if (condition) return;
    failed = true;
    console.error(`${target}: ${message}`);
  };
  check((manifest.content_scripts ?? []).length === 0, 'fresh installs must have no manifest-time content scripts');
  check(permissions.has('scripting'), 'runtime content scripts require scripting permission');
  if (target === 'firefox-mv3') check(!optional.has('declarativeNetRequestWithHostAccess'), 'Firefox must not request Chromium-only DNR permission');
  if (target === 'safari-mv3') {
    check(!permissions.has('downloads') && !permissions.has('offscreen'), 'Safari must use degraded platform capabilities');
    check(optional.size === 0, 'Safari must not declare unsupported optional permissions');
  }
}
if (failed) process.exitCode = 1;
