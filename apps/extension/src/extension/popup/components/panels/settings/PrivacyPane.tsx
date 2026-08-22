import type { PrivacyPreferences } from '@mbd/core/types';
import type { Dispatch, SetStateAction } from 'react';
import { ToggleRow } from '@/extension/popup/components/fields/ToggleRow';

interface PrivacyPaneProps {
  privacy: PrivacyPreferences;
  setPrivacy: Dispatch<SetStateAction<PrivacyPreferences>>;
}

export default function PrivacyPane({ privacy, setPrivacy }: PrivacyPaneProps) {
  const toggle = (key: keyof Omit<PrivacyPreferences, 'version'>): void => {
    setPrivacy((current) => ({ ...current, reviewComplete: true, [key]: !current[key] }));
  };
  return (
    <section role="tabpanel" id="settings-panel-privacy" aria-labelledby="settings-tab-privacy" className="mbd:space-y-3">
      <p className="mbd:text-[11px] mbd:leading-relaxed mbd:text-(--ink-3)">
        These permissions are local to this browser. They are never synced, exported, or restored from backup.
      </p>
      <ToggleRow
        id="privacy-badge-scan"
        label="Automatic media-count scanning"
        description="Scan pages in the background to show a toolbar count. Off means pages are scanned only after an action."
        checked={privacy.automaticBadgeScanning}
        onToggle={() => toggle('automaticBadgeScanning')}
      />
      <ToggleRow
        id="privacy-observe-media"
        label="Observe media requests"
        description="On supported sites, observe media request URLs and selected response bodies locally to find files hidden from the DOM. Existing pages activate immediately; reload to capture requests made before activation."
        checked={privacy.observeMediaRequests}
        onToggle={() => toggle('observeMediaRequests')}
      />
      <ToggleRow
        id="privacy-sankaku-session"
        label="Use my logged-in Sankaku session"
        description="Allow explicit original-resolution actions to send your existing Sankaku session cookie only to Sankaku's pinned API."
        checked={privacy.sankakuSessionResolution}
        onToggle={() => toggle('sankakuSessionResolution')}
      />
      {!privacy.reviewComplete && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setPrivacy((current) => ({ ...current, reviewComplete: true }))}
        >
          Keep automatic access off
        </button>
      )}
    </section>
  );
}
