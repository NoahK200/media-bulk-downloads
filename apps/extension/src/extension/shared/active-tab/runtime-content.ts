const CONTENT_FILE = 'content-scripts/content.js';

/** Inject the idempotent collector/relay into a chosen tab only when a user
 * action needs it. Runtime-registered automatic scans use the same built file. */
export async function ensureContentScript(tabId: number): Promise<void> {
  // Older/test hosts may already have a manifest content script but no scripting
  // API. Let the subsequent message determine reachability in that case.
  if (!chrome.scripting?.executeScript) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
}
