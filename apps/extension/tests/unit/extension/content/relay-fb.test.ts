/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://www.facebook.com/" }
 *
 * The MAIN-world Facebook media relay in src/extension/content/index.ts only
 * wires on facebook.com hosts, so this file pins jsdom's location to
 * facebook.com (jsdom's `location` is immutable at runtime — LegacyUnforgeable
 * — so the host has to be fixed per file via `@vitest-environment-options`). Only
 * the resolver entry point the relay forwards to is spied on; the rest of the
 * module stays real. Handlers are captured and driven directly so assertions
 * never depend on listeners left on `window` by an earlier import.
 */
import type { Mock } from 'vitest';

vi.mock('@mbd/core/resolvers/sites/facebook', async () => ({
  ...(await vi.importActual<typeof import('@mbd/core/resolvers/sites/facebook')>('@mbd/core/resolvers/sites/facebook')),
  ingestSniffedFbMedia: vi.fn(),
}));

export {};

type Handler = (event: unknown) => void;

const loadContent = async (): Promise<{ messageHandlers: Handler[]; ingestSniffedFbMedia: Mock; hydrate: () => void }> => {
  vi.resetModules();
  const addSpy = vi.spyOn(window, 'addEventListener');
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  (chrome.runtime.sendMessage as Mock).mockReturnValue(Promise.resolve(undefined));

  await import('@/extension/content/sniffer-relay');

  const messageHandlers = addSpy.mock.calls
    .filter((c) => c[0] === 'message')
    .map((c) => c[1] as Handler);
  addSpy.mockRestore();

  const fbMod = await import('@mbd/core/resolvers/sites/facebook');
  const ingestSniffedFbMedia = fbMod.ingestSniffedFbMedia as unknown as Mock;
  const { clearSnifferBuffers, hydrateSnifferBuffers } = await import('@/extension/content/sniffer-hydrate');
  clearSnifferBuffers();
  ingestSniffedFbMedia.mockClear();
  return { messageHandlers, ingestSniffedFbMedia, hydrate: hydrateSnifferBuffers };
};

const fire = (handlers: Handler[], event: unknown): void => handlers.forEach((h) => h(event));

const message = (data: unknown, over: { source?: unknown; origin?: string } = {}): unknown => ({
  source: 'source' in over ? over.source : window,
  origin: 'origin' in over ? over.origin : window.location.origin,
  data,
});

describe('Facebook media relay (facebook.com)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.resetModules();
  });

  it('feeds a valid mbd-fb-media envelope to ingestSniffedFbMedia', async () => {
    const { messageHandlers, ingestSniffedFbMedia, hydrate } = await loadContent();
    const entries = [{ fbid: '100', kind: 'image', url: 'https://x.fbcdn.net/a.jpg' }];
    fire(messageHandlers, message({ source: 'mbd-fb-media', entries }));
    hydrate();
    expect(ingestSniffedFbMedia).toHaveBeenCalledWith(entries);
  });

  it('wires both the FB and HLS relays on facebook.com', async () => {
    expect((await loadContent()).messageHandlers).toHaveLength(3);
  });

  it('ignores a foreign window source, a foreign origin, a wrong tag, and a non-array entries', async () => {
    const { messageHandlers, ingestSniffedFbMedia, hydrate } = await loadContent();
    fire(messageHandlers, message({ source: 'mbd-fb-media', entries: [] }, { source: {} }));
    fire(messageHandlers, message({ source: 'mbd-fb-media', entries: [] }, { origin: 'https://evil.example' }));
    fire(messageHandlers, message({ source: 'mbd-not-fb', entries: [] }));
    fire(messageHandlers, message({ source: 'mbd-fb-media', entries: 'nope' }));
    fire(messageHandlers, message(null));
    hydrate();
    expect(ingestSniffedFbMedia).toHaveBeenCalledWith([]);
  });

  it('announces mbd-fb-ready so the MAIN sniffer can replay early graphql', async () => {
    vi.resetModules();
    const postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined as never);
    await import('@/extension/content/sniffer-relay');
    expect(postSpy).toHaveBeenCalledWith({ source: 'mbd-fb-ready' }, window.location.origin);
  });
});
