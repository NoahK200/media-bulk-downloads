import {
  DEFAULT_PRIVACY_PREFERENCES,
  PRIVACY_KEY,
  loadPrivacyPreferences,
  sanitizePrivacyPreferences,
  savePrivacyPreferences,
} from '@mbd/storage/privacy';

describe('local privacy preferences', () => {
  it('fails closed for missing, old, or malformed data', () => {
    expect(sanitizePrivacyPreferences(undefined)).toEqual(DEFAULT_PRIVACY_PREFERENCES);
    expect(sanitizePrivacyPreferences({ version: 0, observeMediaRequests: true })).toEqual(DEFAULT_PRIVACY_PREFERENCES);
    expect(sanitizePrivacyPreferences({ version: 1, observeMediaRequests: 'yes' })).toEqual(DEFAULT_PRIVACY_PREFERENCES);
  });

  it('round-trips only the strict local consent shape', async () => {
    const value = {
      version: 1 as const,
      reviewComplete: true,
      automaticBadgeScanning: true,
      observeMediaRequests: true,
      sankakuSessionResolution: true,
    };
    expect(await savePrivacyPreferences(value)).toEqual({ ok: true });
    expect(await loadPrivacyPreferences()).toEqual(value);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ [PRIVACY_KEY]: value });
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
});
