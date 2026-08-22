/**
 * @mbd/platform — the browser-capability seam.
 *
 * This package holds only the CONTRACTS (interfaces) and runtime feature
 * detection. The Chrome/Firefox/Safari IMPLEMENTATIONS live in the app
 * layer (apps/extension/src/extension/platform/*), because
 * they hold the divergent chrome.* APIs and read the WXT build-time browser
 * flag. Keeping the contracts here lets a new target be added by supplying one
 * folder of implementations without touching @mbd/core or @mbd/storage. The
 * seam is wired through the background download, notification, header-rule,
 * and capture paths.
 */
export type { Downloader, DownloadRequest, DownloadStartResult, DownloadRecord, DownloadQuery, DownloadChangeListener } from '@mbd/platform/downloader';
export type { Notifier, NotificationOptions } from '@mbd/platform/notifier';
export type { HeaderRules, HeaderOverride } from '@mbd/platform/header-rules';
export type { StreamCaptureHost, CaptureRunRequest, CaptureRunResult } from '@mbd/platform/stream-capture';
export type { Capabilities } from '@mbd/platform/capabilities';
export { detectCapabilities } from '@mbd/platform/capabilities';
