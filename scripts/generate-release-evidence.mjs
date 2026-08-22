/* global URL, console, process */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestFile = async (path) => digest(await readFile(path));
const listFiles = async (root) => {
  try {
    return (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => resolve(entry.parentPath, entry.name))
      .sort();
  } catch { return []; }
};

const sha = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain');
if (dirty) throw new Error('Release evidence requires a clean worktree.');

const tracked = git('ls-files', '-z').split('\0').filter(Boolean).sort();
const sourceHash = createHash('sha256');
for (const path of tracked) {
  sourceHash.update(path).update('\0').update(await readFile(resolve(repo, path))).update('\0');
}

const packagePaths = ['package.json', 'apps/extension/package.json', 'yarn.lock'];
const packageDigests = Object.fromEntries(await Promise.all(packagePaths.map(async (path) => [path, await digestFile(resolve(repo, path))])));
const rootPackage = JSON.parse(await readFile(resolve(repo, 'package.json'), 'utf8'));
const extensionPackage = JSON.parse(await readFile(resolve(repo, 'apps/extension/package.json'), 'utf8'));

const outputRoot = resolve(repo, 'apps/extension/.output');
const manifests = {};
for (const target of ['chrome-mv3', 'edge-mv3', 'firefox-mv3', 'safari-mv3']) {
  try {
    const path = resolve(outputRoot, target, 'manifest.json');
    manifests[target] = { sha256: await digestFile(path), manifest: JSON.parse(await readFile(path, 'utf8')) };
  } catch { manifests[target] = { missing: true }; }
}

const artifactRoot = resolve(repo, process.env.EVIDENCE_ARTIFACT_DIR || 'collected-artifacts');
const artifacts = {};
for (const path of await listFiles(artifactRoot)) {
  const info = await stat(path);
  artifacts[relative(artifactRoot, path).replaceAll('\\', '/')] = { size: info.size, sha256: await digestFile(path) };
}

const exceptions = JSON.parse(await readFile(resolve(repo, 'release-exceptions.json'), 'utf8'));
for (const [kind, entries] of Object.entries(exceptions)) {
  if (!Array.isArray(entries)) throw new Error(`${kind} exception list must be an array.`);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.reason !== 'string' || typeof entry.expires !== 'string') {
      throw new Error(`${kind} exceptions require reason and expires fields.`);
    }
    const expiry = Date.parse(entry.expires);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error(`${kind} exception expired: ${entry.reason}`);
  }
}
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: sha,
  cleanWorktree: true,
  sourceSha256: sourceHash.digest('hex'),
  versions: { root: rootPackage.version, extension: extensionPackage.version },
  packageDigests,
  manifests,
  artifacts,
  gates: {
    validate: process.env.VALIDATE_RESULT || 'unknown',
    edgeInstalled: process.env.EDGE_RESULT || 'unknown',
    firefoxInstalled: process.env.FIREFOX_RESULT || 'unknown',
    safariUnsigned: process.env.SAFARI_RESULT || 'unknown',
    desktopMatrix: process.env.DESKTOP_RESULT || 'unknown',
  },
  proofLevels: {
    unit: 'CI validate job',
    chromiumE2E: 'packaged extension, repeated twice, zero retries',
    edgeInstalled: 'Edge channel with edge-mv3 output',
    firefoxInstalled: 'temporary XPI Selenium smoke',
    safari: 'unsigned converter/xcodebuild only; signed manual candidate evidence remains required',
    desktop: 'Deno tests on Windows, macOS, and Linux in the test workflow',
  },
  safariManualEvidence: {
    operator: process.env.SAFARI_MANUAL_OPERATOR || null,
    date: process.env.SAFARI_MANUAL_DATE || null,
    candidateDigest: process.env.SAFARI_MANUAL_DIGEST || null,
    complete: Boolean(process.env.SAFARI_MANUAL_OPERATOR && process.env.SAFARI_MANUAL_DATE && process.env.SAFARI_MANUAL_DIGEST),
  },
  exceptions,
};

const outDir = resolve(repo, 'release-evidence', sha);
await mkdir(outDir, { recursive: true });
const out = resolve(outDir, 'evidence.json');
await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(out);
