# Release validation and evidence

Release candidates are forward-fix only. Do not roll back to a build that
registers page observers without local consent.

## Proof levels

- **Unit/integration:** Vitest and Deno tests, including whole-source coverage.
- **Chromium E2E:** the generated Chrome MV3 directory loaded into Playwright's
  pinned Chromium; the release gate repeats every case twice with zero retries.
- **Installed browser:** Edge runs the shared suite with the `msedge` channel and
  Edge manifest. Firefox installs the temporary XPI through Selenium, resolves
  its generated `moz-extension` UUID, and exercises collection, settings, queue,
  and download behavior.
- **Safari unsigned:** the converter, unsigned Xcode build, and XCTest host-app
  launch smoke run on macOS.
- **Packaged product/manual:** a signed Safari candidate still requires the
  operator checklist below. Static, unit, or Chromium proof cannot substitute.

## Safari signed-candidate checklist

Record the operator, date, candidate SHA-256, macOS/Safari versions, and result
for every item:

- Scan a local fixture from a fresh profile.
- Enable and disable request observation; verify registration changes and reload notice.
- Dispatch more than five downloads; verify the queue does not stall.
- Reopen queue and history; verify untracked controls are absent.
- Capture a local direct HLS stream and verify delayed artifact cleanup.

Provide `SAFARI_MANUAL_OPERATOR`, `SAFARI_MANUAL_DATE`, and
`SAFARI_MANUAL_DIGEST` to the release workflow. A missing signed checklist means
no Safari store artifact is emitted; it does not block unrelated browser artifacts.

## Evidence bundle

The release workflow generates `release-evidence/<commit>/evidence.json` only
from a clean checkout. It binds the commit, tracked-source digest, package and
lockfile digests, versions, generated manifests, candidate artifact hashes,
gate results, proof levels, manual Safari metadata, and expiring exceptions.

Chrome publication downloads the already-hashed candidate artifact instead of
rebuilding it. Edge and Firefox artifacts are attached only when their own
installed-browser gates pass.

## Rollout

1. Publish the candidate digest to a beta/test listing.
2. Exercise fresh-install, upgrade, privacy-review, storage-failure, and consent-revocation flows.
3. Promote the identical SHA-256 candidate; do not rebuild between beta and production.
4. If a privacy or credential-scope regression is found, issue a forward fix.
