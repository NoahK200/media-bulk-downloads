import { ResolveCredentialScope, ResolveHint, ResolvedMedia, ResolveOriginalsResponse } from '@mbd/core/types';

/**
 * Asks the background to resolve original media URLs for the given hints
 * (opt-in, network-fetching resolution). Resolves to an empty map on error
 * or when there's nothing to resolve.
 */
export async function requestResolveOriginals(
  targets: { src: string; hint: ResolveHint }[],
  credentialScopes: ResolveCredentialScope[] = [],
): Promise<Record<string, ResolvedMedia>> {
  if (!targets.length) return {};
  const scopedCredentials = targets.some((target) => target.hint.platform === 'sankaku')
    ? credentialScopes.filter((scope) => scope === 'sankaku-session')
    : [];
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'RESOLVE_ORIGINALS', hints: targets, credentialScopes: scopedCredentials }, (resp: ResolveOriginalsResponse) => {
      if (chrome.runtime.lastError || !resp) return resolve({});
      resolve(resp.resolved || {});
    });
  });
}
