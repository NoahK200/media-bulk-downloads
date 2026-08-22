import { Dispatch, RefObject, SetStateAction, useEffect, useRef, useState } from 'react';
import { MutationResponse, SettingsData } from '@mbd/core/types';
import { DEFAULT_SETTINGS, withDefaults, loadStoredSettings } from '@mbd/storage/settings';

export interface UseSettingsResult {
  settings: SettingsData;
  setSettings: Dispatch<SetStateAction<SettingsData>>;
  settingsRef: RefObject<SettingsData>;
  handleSettingsChange: (newSettings: SettingsData) => Promise<MutationResponse>;
}

/**
 * Tracks the extension's settings and keeps them live while the popup is
 * open. `settingsRef` mirrors the latest value for synchronous reads from
 * async callbacks (the mount scan, the scan/resolution engine) without a
 * stale closure.
 *
 * The sync-storage 'settings' listener below must be registered between the
 * favourites and excluded local listeners (App calls this hook at that
 * position) so all three keep their positional order in tests.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    void loadStoredSettings().then((loaded) => {
      settingsRef.current = loaded;
      setSettings(loaded);
    });
  }, []);

  useEffect(() => {
    const listener = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'sync' || !changes.settings) return;
      const next = withDefaults(changes.settings.newValue as Partial<SettingsData>);
      settingsRef.current = next;
      setSettings(next);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleSettingsChange = (newSettings: SettingsData): Promise<MutationResponse> => new Promise((resolve) => {
    const { bubblePosition, bubblePanelPoint, ...rest } = newSettings;
    void bubblePanelPoint;
    chrome.runtime.sendMessage(
      { type: 'SET_SETTINGS', patch: { ...rest, bubblePosition: { corner: bubblePosition.corner } } },
      (response?: MutationResponse) => {
        const error = chrome.runtime.lastError;
        if (error || !response) {
          resolve({ status: 'error', code: 'runtime-error', message: error?.message || 'Settings were not saved.' });
          return;
        }
        if (response.status === 'success') setSettings(newSettings);
        resolve(response);
      },
    );
  });

  return { settings, setSettings, settingsRef, handleSettingsChange };
}
