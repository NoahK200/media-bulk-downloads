import { SettingsData, SettingsRepair } from '@mbd/core/types';
import { AUDIO_FORMATS } from '@mbd/core/download/stream/mp3';

/** Default user settings, shared by the popup, background worker, and bubble. */
export const DEFAULT_SETTINGS: SettingsData = {
  downloadPath: '',
  fileNamePrefix: 'image_',
  popupWidth: 460,
  popupHeight: 600,
  minimumImageSize: 0,
  excludeBase64Images: false,
  excludeEmoji: false,
  saveAs: false,
  notifyOnComplete: false,
  convertImagesTo: 'off',
  convertMetadata: 'preserve',
  namingMode: 'prefixed',
  thumbnailSize: 120,
  previewSize: 360,
  bubbleEnabled: false,
  bubblePosition: { corner: 'bottom-right', x: 20, y: 20 },
  bubbleWidth: 440,
  bubbleHeight: 560,
  bubblePanelPlacement: 'anchored',
  bubblePanelPoint: { x: 40, y: 40 },
  resolveOriginals: false,
  captureHlsStreams: false,
  streamQuality: 'auto',
  audioFormat: 'm4a',
  downloadConcurrency: 5,
  deepScanMaxItems: 1000,
  deepScanMaxSeconds: 20,
  deepScanMaxScrolls: 40,
  deepScanClickLoadMore: false,
  smartPageDefaults: true,
  rememberScanBehaviour: true,
  skipDuplicateDownloads: true,
  metadataSidecar: false,
  nearDuplicateThreshold: 8,
};

const MAX_SETTING_STRING = 1_024;
const own = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/** A plain object, or {} — corrupt strings/arrays/numbers never become settings. */
const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Strictly validate all settings. Missing fields use the fallback without being
 * reported; present invalid fields are repaired and surfaced to import callers. */
export function sanitizeSettings(
  stored: unknown,
  fallback: SettingsData = DEFAULT_SETTINGS,
): { settings: SettingsData; repairs: SettingsRepair[] } {
  const s = asObject(stored);
  const repairs: SettingsRepair[] = [];
  const repair = (key: string, reason: SettingsRepair['reason']): void => {
    repairs.push({ key, reason });
  };
  const bool = <K extends keyof SettingsData>(key: K): SettingsData[K] => {
    if (!own(s, String(key))) return fallback[key];
    if (typeof s[String(key)] !== 'boolean') {
      repair(String(key), 'wrong-type');
      return fallback[key];
    }
    return s[String(key)] as SettingsData[K];
  };
  const str = <K extends keyof SettingsData>(key: K): SettingsData[K] => {
    if (!own(s, String(key))) return fallback[key];
    const value = s[String(key)];
    if (typeof value !== 'string') {
      repair(String(key), 'wrong-type');
      return fallback[key];
    }
    if (value.length > MAX_SETTING_STRING) {
      repair(String(key), 'too-long');
      return value.slice(0, MAX_SETTING_STRING) as SettingsData[K];
    }
    return value as SettingsData[K];
  };
  const integer = <K extends keyof SettingsData>(key: K, min: number, max: number): SettingsData[K] => {
    if (!own(s, String(key))) return fallback[key];
    const raw = s[String(key)];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      repair(String(key), 'wrong-type');
      return fallback[key];
    }
    const value = Math.floor(raw);
    if (value < min || value > max) repair(String(key), 'out-of-range');
    return Math.min(max, Math.max(min, value)) as SettingsData[K];
  };
  const enumeration = <K extends keyof SettingsData>(key: K, allowed: readonly unknown[]): SettingsData[K] => {
    if (!own(s, String(key))) return fallback[key];
    const value = s[String(key)];
    if (!allowed.includes(value)) {
      repair(String(key), typeof value === 'string' ? 'invalid-enum' : 'wrong-type');
      return fallback[key];
    }
    return value as SettingsData[K];
  };
  const coordinate = (obj: Record<string, unknown>, key: 'x' | 'y', fallbackValue: number, prefix: string): number => {
    if (!own(obj, key)) return fallbackValue;
    const raw = obj[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      repair(`${prefix}.${key}`, 'wrong-type');
      return fallbackValue;
    }
    if (raw < -10_000 || raw > 10_000) repair(`${prefix}.${key}`, 'out-of-range');
    return Math.min(10_000, Math.max(-10_000, raw));
  };

  const cornerValues = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  const rawPosition = own(s, 'bubblePosition') ? asObject(s.bubblePosition) : {};
  if (own(s, 'bubblePosition') && (!s.bubblePosition || typeof s.bubblePosition !== 'object' || Array.isArray(s.bubblePosition))) {
    repair('bubblePosition', 'wrong-type');
  }
  const rawCorner = rawPosition.corner;
  const corner = rawCorner === undefined
    ? fallback.bubblePosition.corner
    : cornerValues.includes(rawCorner as (typeof cornerValues)[number])
      ? rawCorner as SettingsData['bubblePosition']['corner']
      : (repair('bubblePosition.corner', typeof rawCorner === 'string' ? 'invalid-enum' : 'wrong-type'), fallback.bubblePosition.corner);
  const rawPanelPoint = own(s, 'bubblePanelPoint') ? asObject(s.bubblePanelPoint) : {};
  if (own(s, 'bubblePanelPoint') && (!s.bubblePanelPoint || typeof s.bubblePanelPoint !== 'object' || Array.isArray(s.bubblePanelPoint))) {
    repair('bubblePanelPoint', 'wrong-type');
  }

  return {
    settings: {
      downloadPath: str('downloadPath'),
      fileNamePrefix: str('fileNamePrefix'),
      popupWidth: integer('popupWidth', 320, 800),
      popupHeight: integer('popupHeight', 400, 600),
      minimumImageSize: integer('minimumImageSize', 0, 10_000),
      excludeBase64Images: bool('excludeBase64Images'),
      excludeEmoji: bool('excludeEmoji'),
      saveAs: bool('saveAs'),
      notifyOnComplete: bool('notifyOnComplete'),
      convertImagesTo: enumeration('convertImagesTo', ['off', 'png', 'jpeg']),
      convertMetadata: enumeration('convertMetadata', ['preserve', 'strip']),
      namingMode: enumeration('namingMode', ['original', 'prefixed']),
      thumbnailSize: integer('thumbnailSize', 64, 240),
      previewSize: integer('previewSize', 240, 900),
      bubbleEnabled: bool('bubbleEnabled'),
      bubblePosition: {
        corner,
        x: coordinate(rawPosition, 'x', fallback.bubblePosition.x, 'bubblePosition'),
        y: coordinate(rawPosition, 'y', fallback.bubblePosition.y, 'bubblePosition'),
      },
      bubbleWidth: integer('bubbleWidth', 320, 3_840),
      bubbleHeight: integer('bubbleHeight', 360, 2_160),
      bubblePanelPlacement: enumeration('bubblePanelPlacement', ['anchored', 'center', 'free', ...cornerValues]),
      bubblePanelPoint: {
        x: coordinate(rawPanelPoint, 'x', fallback.bubblePanelPoint.x, 'bubblePanelPoint'),
        y: coordinate(rawPanelPoint, 'y', fallback.bubblePanelPoint.y, 'bubblePanelPoint'),
      },
      resolveOriginals: bool('resolveOriginals'),
      captureHlsStreams: bool('captureHlsStreams'),
      streamQuality: enumeration('streamQuality', ['auto', 'best', 'worst', '1080', '720', '480']),
      audioFormat: enumeration('audioFormat', AUDIO_FORMATS),
      downloadConcurrency: integer('downloadConcurrency', 1, 20),
      deepScanMaxItems: integer('deepScanMaxItems', 1, 100_000),
      deepScanMaxSeconds: integer('deepScanMaxSeconds', 1, 600),
      deepScanMaxScrolls: integer('deepScanMaxScrolls', 1, 10_000),
      deepScanClickLoadMore: bool('deepScanClickLoadMore'),
      smartPageDefaults: bool('smartPageDefaults'),
      rememberScanBehaviour: bool('rememberScanBehaviour'),
      skipDuplicateDownloads: bool('skipDuplicateDownloads'),
      metadataSidecar: bool('metadataSidecar'),
      nearDuplicateThreshold: integer('nearDuplicateThreshold', 2, 16),
    },
    repairs,
  };
}

/** Compatibility wrapper for existing consumers that only need repaired data. */
export function withDefaults(stored: unknown): SettingsData {
  return sanitizeSettings(stored).settings;
}

/** Read the persisted global settings from sync storage, merged over defaults.
 *  Promise-WRAPS the callback form of storage.sync.get (not the promise form):
 *  production-correct under MV3, and compatible with the test suite's callback
 *  mocks. Tolerant of an unset key (→ DEFAULT_SETTINGS). Shared by the popup
 *  mount load, the media engine's default loader, and the per-host effective
 *  resolver, so all read the global layer identically. */
export function loadStoredSettings(): Promise<SettingsData> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], (r) => resolve(withDefaults((r as { settings?: unknown })?.settings)));
  });
}
