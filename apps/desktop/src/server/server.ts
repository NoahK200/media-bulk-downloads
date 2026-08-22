import type { ServerHandle, StartServerOpts } from './types.ts';

export function makeToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function isAllowedHost(host: string | null, port: number): boolean {
  return host === `127.0.0.1:${port}`;
}

// Match "GET /api/foo/:id" patterns against a concrete path; returns the handler
// key and params, or null.
function matchRoute(api: Record<string, unknown>, method: string, path: string): string | null {
  for (const key of Object.keys(api)) {
    const [m, pat] = key.split(' ');
    if (m !== method) continue;
    const ps = pat.split('/'), cs = path.split('/');
    if (ps.length !== cs.length) continue;
    if (ps.every((seg, i) => seg.startsWith(':') || seg === cs[i])) return key;
  }
  return null;
}

export function startServer(opts: StartServerOpts): Promise<ServerHandle> {
  const token = makeToken();
  const ac = new AbortController();
  let boundPort = opts.port ?? 0;
  return new Promise((resolve) => {
    const server = Deno.serve({
      hostname: '127.0.0.1',
      port: opts.port ?? 0,
      signal: ac.signal,
      onListen: ({ port }) => {
        boundPort = port;
        resolve({ port, token, close: async () => { ac.abort(); await server.finished; } });
      },
    }, async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;
      const expectedHost = `127.0.0.1:${boundPort}`;
      if (!isAllowedHost(req.headers.get('host'), boundPort)) return new Response('invalid host', { status: 421 });
      const headers = new Headers({
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      const sameOrigin = `http://${expectedHost}`;
      const fetchSite = req.headers.get('sec-fetch-site');
      if (fetchSite === 'cross-site') return new Response('forbidden', { status: 403, headers });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('origin');
        if (origin !== sameOrigin) return new Response('forbidden', { status: 403, headers });
      }

      // Static assets are public code only. The token-bearing shell is available
      // solely at its unguessable session path.
      if (!pathname.startsWith('/api/') && pathname !== '/events') {
        const shellPath = `/session/${token}/`;
        const isShell = pathname === shellPath;
        if (pathname === '/' || pathname === '') return new Response('not found', { status: 404, headers });
        const asset = isShell ? opts.assets['/'] : opts.assets[pathname];
        if (!asset) return new Response('not found', { status: 404, headers });
        const body = isShell ? asset.body.replaceAll('__MBD_TOKEN__', token) : asset.body;
        headers.set('content-type', asset.type);
        if (isShell) {
          headers.set('cache-control', 'no-store');
          headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        }
        return new Response(body, { headers });
      }
      // Token guard for /api + /events.
      const supplied = req.headers.get('x-mbd-token');
      if (supplied !== token) return new Response('unauthorized', { status: 401, headers });
      headers.set('cache-control', 'no-store');
      if (pathname === '/events' && opts.sse) {
        const response = await opts.sse(req, url);
        for (const [name, value] of headers) if (!response.headers.has(name)) response.headers.set(name, value);
        return response;
      }
      const key = matchRoute(opts.api, req.method, pathname);
      if (!key) return new Response('not found', { status: 404, headers });
      let response: Response;
      try {
        response = await opts.api[key](req, url);
      } catch (error) {
        const status = typeof (error as { status?: unknown })?.status === 'number'
          ? (error as { status: number }).status
          : 400;
        response = Response.json({ error: status === 413 ? 'request too large' : 'invalid request' }, { status });
      }
      for (const [name, value] of headers) if (!response.headers.has(name)) response.headers.set(name, value);
      return response;
    });
  });
}
