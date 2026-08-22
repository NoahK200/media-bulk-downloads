import type { SettingsChangedMessage, SettingsData } from '@mbd/core/types';
import { withDefaults } from '@mbd/storage/settings';

let controller: { unmount: () => void } | null = null;
let wanted = false;
async function mount(settings: SettingsData): Promise<void> {
  if (controller) return;
  const module = await import('@/extension/bubble/mount');
  if (!controller && wanted) controller = module.mountBubble(settings);
}
function apply(settings: SettingsData): void {
  wanted = settings.bubbleEnabled;
  if (wanted) void mount(settings);
  else { controller?.unmount(); controller = null; }
}
if (window.top === window.self) {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings?: Partial<SettingsData>) => {
    void chrome.runtime.lastError;
    apply(withDefaults(settings));
  });
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'SETTINGS_CHANGED') {
      apply(withDefaults((message as SettingsChangedMessage).settings));
    }
  });
}

