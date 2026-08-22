import { useCallback, useEffect, useState } from 'react';
import type { MutationResponse, PrivacyPreferences } from '@mbd/core/types';
import {
  DEFAULT_PRIVACY_PREFERENCES,
  PRIVACY_KEY,
  sanitizePrivacyPreferences,
} from '@mbd/storage/privacy';

export interface UsePrivacyResult {
  privacy: PrivacyPreferences;
  savePrivacy: (next: PrivacyPreferences) => Promise<MutationResponse>;
}

/** Privacy consent is local-only and background-owned. The popup reads through
 * runtime messaging so the same path works from the content-script bubble. */
export function usePrivacy(): UsePrivacyResult {
  const [privacy, setPrivacy] = useState<PrivacyPreferences>(DEFAULT_PRIVACY_PREFERENCES);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PRIVACY_PREFERENCES' }, (response?: PrivacyPreferences) => {
      void chrome.runtime.lastError;
      if (response) setPrivacy(sanitizePrivacyPreferences(response));
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area === 'local' && changes[PRIVACY_KEY]) {
        setPrivacy(sanitizePrivacyPreferences(changes[PRIVACY_KEY].newValue));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const savePrivacy = useCallback((next: PrivacyPreferences): Promise<MutationResponse> =>
    new Promise((resolve) => {
      const patch = {
        reviewComplete: next.reviewComplete,
        automaticBadgeScanning: next.automaticBadgeScanning,
        observeMediaRequests: next.observeMediaRequests,
        sankakuSessionResolution: next.sankakuSessionResolution,
      };
      chrome.runtime.sendMessage(
        {
          type: 'SET_PRIVACY_PREFERENCES',
          patch,
        },
        (response?: MutationResponse) => {
          const error = chrome.runtime.lastError;
          if (error || !response) {
            resolve({ status: 'error', code: 'runtime-error', message: error?.message || 'Privacy preferences were not saved.' });
            return;
          }
          if (response.status === 'success') setPrivacy(next);
          resolve(response);
        },
      );
    }), []);

  return { privacy, savePrivacy };
}
