import type { PersistenceResult, PrivacyPreferences } from '@mbd/core/types';

/** Local-only privacy consent. Deliberately absent from MANAGED_KEYS and backup
 * exports so another profile, device, or restore can never enable inspection. */
export const PRIVACY_KEY = 'privacyPreferences';

export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = {
  version: 1,
  reviewComplete: false,
  automaticBadgeScanning: false,
  observeMediaRequests: false,
  sankakuSessionResolution: false,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function sanitizePrivacyPreferences(value: unknown): PrivacyPreferences {
  if (!isObject(value) || value.version !== 1) return { ...DEFAULT_PRIVACY_PREFERENCES };
  return {
    version: 1,
    reviewComplete: value.reviewComplete === true,
    automaticBadgeScanning: value.automaticBadgeScanning === true,
    observeMediaRequests: value.observeMediaRequests === true,
    sankakuSessionResolution: value.sankakuSessionResolution === true,
  };
}

function failureCode(error: unknown): Exclude<PersistenceResult, { ok: true }>['code'] {
  const name = error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota';
  if (name === 'InvalidStateError' || /unavailable|disabled|not available/i.test(message)) return 'unavailable';
  return 'unknown';
}

export async function loadPrivacyPreferences(): Promise<PrivacyPreferences> {
  try {
    const result = await chrome.storage.local.get(PRIVACY_KEY);
    return sanitizePrivacyPreferences(result[PRIVACY_KEY]);
  } catch {
    return { ...DEFAULT_PRIVACY_PREFERENCES };
  }
}

/** Replace local privacy preferences. Missing/invalid fields fail closed. */
export async function savePrivacyPreferences(value: unknown): Promise<PersistenceResult> {
  try {
    await chrome.storage.local.set({ [PRIVACY_KEY]: sanitizePrivacyPreferences(value) });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
}

/** Merge a patch through the same serialized single-writer path used by the
 * background. Privacy consent is never written directly by popup/content code. */
let writeChain: Promise<unknown> = Promise.resolve();
export function patchPrivacyPreferences(patch: Partial<PrivacyPreferences>): Promise<{
  result: PersistenceResult;
  preferences: PrivacyPreferences;
}> {
  const run = writeChain.then(async () => {
    const current = await loadPrivacyPreferences();
    const preferences = sanitizePrivacyPreferences({ ...current, ...patch, version: 1 });
    return { result: await savePrivacyPreferences(preferences), preferences };
  });
  writeChain = run.catch(() => undefined);
  return run;
}
