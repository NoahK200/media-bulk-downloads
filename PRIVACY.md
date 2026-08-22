# Privacy Policy — Media Bulk Downloads

_Last updated: 2026-07-22_

Media Bulk Downloads ("the extension") is a browser extension that finds images,
video, and audio on the web page you are viewing and lets you preview, filter,
and download them.

## Summary

**The extension does not collect, store off your device, transmit, or sell any
personal information.** All of its work happens locally in your browser.

## What the extension accesses

- **The content of the page you actively choose to scan.** Opening the popup,
  using a download command, or enabling the on-page panel injects the collector
  into that page and reads its media elements locally. Optional automatic toolbar
  counts can scan pages in the background only after you enable that local
  privacy control.
- **The active tab's URL and title.** Used only to label a download with the page
  it came from (shown in your local download history) and, when you click "Open
  source", to open that URL in a new tab.

## What the extension stores (locally, on your device)

- **Your settings** — via `chrome.storage.sync` (so they follow your Chrome
  profile). No content, only preferences.
- **Privacy consent** — stored only in `chrome.storage.local` on this browser.
  Automatic scanning, media-request observation, and authenticated Sankaku
  resolution never sync and are never included in backups.
- **Your download history** — via `chrome.storage.local`. A list of files you
  downloaded through the extension (filename, source page, timestamp, thumbnail
  URL).
- **Your favourites** — a list of media you have starred to re-download later
  (URL, thumbnail, source page). Local only.
- **Your blocked/excluded sources** — hosts or URL patterns you chose to hide from
  results. Local only, a list of your own choices.
- **Your download queue** — the pending/in-progress batch, so it survives closing
  the popup and resumes interrupted items. Local only.

For durability, history, favourites, blocked sources, and the queue are also
mirrored to an on-device IndexedDB store (requested via `navigator.storage.persist()`)
so the browser does not evict them under storage pressure. Everything here stays on
your device (and, for settings, within your own Chrome sync account); the extension
has no server and no analytics.

You control all of it: clear download history from the History panel, and use
**Settings → Data** to **reset all settings to defaults** or **clear all local
data** (history, favourites, and blocked sources) in one step. You can also export
any of it to a JSON file and re-import it (Settings → Backup).

## Network requests

By default the extension is **network-free and observation-free** — it only reads what the page has
already loaded and hands URLs to Chrome's download manager. A few features make
network requests or observe page requests, each behind an explicit control:

- **"Resolve exact originals"** (off by default) fetches a higher-resolution
  version of an item you are downloading from that item's own media host. It
  covers a broad set of platforms — Twitter/X, Instagram, Facebook, Threads,
  Pinterest, Reddit, Flickr, ArtStation, Behance, Bluesky, Unsplash, Wallhaven,
  Vimeo, Dailymotion, Mastodon, YouTube, Booru sites, and similar; for most items
  the original is derived with no network call at all. The current list lives in
  [https://mralaminahamed.github.io/media-bulk-downloads/how-it-works/resolve-originals/](https://mralaminahamed.github.io/media-bulk-downloads/how-it-works/resolve-originals/).
- On a Shopify product page, Resolve exact originals may request the store's
  public same-origin `/products/<handle>.js` endpoint with credentials omitted.
- **HLS / DASH stream capture** (triggered per item, only when you capture a
  stream) fetches the stream's manifest and its media segments from the stream's
  own host to assemble the file locally. Nothing about you is sent; it only
  requests the segments the player itself would.
- **Observe media requests** is a separate, local-only control. When enabled,
  the extension notes `.m3u8`/`.mpd` request URLs and, on supported sites such
  as Facebook, Instagram, X, Pinterest, and MangaDex, reads selected media API
  response bodies to extract media URLs. Raw bodies are never persisted or sent
  off the device. Disabling the control stops observation immediately; reload a
  page after enabling it to capture requests made during page startup.
- **Use my logged-in Sankaku session** is local-only and off by default. When
  enabled, an explicit original-resolution action may send the browser's existing
  Sankaku cookie only to the pinned Sankaku API. It is never enabled by backup or sync.
- **"Retry with page referer"** (only when you click it on a download a site
  blocked with HTTP 403) sets that one request's `Referer`/`Origin` to the item's
  source page so the file downloads, then removes the rule.

**The Support link.** The popup and on-page panel include an optional **Support the
project** link to the developer's donation page (`alaminahamed.com/donate`). It is a
plain link — the extension makes **no** automatic or background request to it and
sends **nothing**; it opens that page in a new tab only if *you* click it, exactly
like clicking any link on a web page.

## Permissions

See the extension's Chrome Web Store listing for a plain-language justification of
each permission. In short: `downloads`/`downloads.open` save and open your files,
`storage` keeps your settings and history on your device, `tabs` labels downloads
  with their source page, `scripting` injects the collector only after an action
  or local consent, and host access lets the extension read media on selected pages.

Two permissions are **optional** and requested only when you turn the matching
feature on, never at install: `notifications` (a local desktop toast when a
download batch finishes) and `declarativeNetRequestWithHostAccess` (used only if you choose
"Retry with page referer" on a download a site blocked with HTTP 403 — it sets
that one request's `Referer`/`Origin` to the item's own source page so the file
downloads, then removes the rule). Both act entirely on your device; neither sends
any data off it.

## Data sharing

None. No data is sold, rented, or shared with any third party. No data is used for
advertising, creditworthiness, or any purpose unrelated to the single purpose
above.

## Contact

Questions about this policy: alamin.ahamed.dev@gmail.com
