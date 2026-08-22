import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { isAllowedHost, startServer } from '../../src/server/server.ts';

const assets = { '/': { body: '<div id="root">__MBD_TOKEN__</div>', type: 'text/html; charset=utf-8' } };

Deno.test('serves index with token injected', async () => {
  const s = await startServer({ assets, api: {} });
  const root = await fetch(`http://127.0.0.1:${s.port}/`);
  assertEquals(root.status, 404);
  assertEquals((await root.text()).includes(s.token), false);
  const res = await fetch(`http://127.0.0.1:${s.port}/session/${s.token}/`);
  const html = await res.text();
  assertStringIncludes(html, s.token);          // placeholder replaced
  assertEquals(res.headers.get('x-content-type-options'), 'nosniff');
  assertStringIncludes(res.headers.get('content-security-policy') ?? '', "default-src 'self'");
  await s.close();
});

Deno.test('rejects a rebinding-style Host header before serving the token shell', () => {
  assertEquals(isAllowedHost('attacker.example:48123', 48123), false);
  assertEquals(isAllowedHost('127.0.0.1:48123', 48123), true);
});

Deno.test('rejects a spoofed Host header on the live listener', async () => {
  const s = await startServer({ assets, api: {} });
  const conn = await Deno.connect({ hostname: '127.0.0.1', port: s.port });
  const request = `GET /session/${s.token}/ HTTP/1.1\r\nHost: attacker.example:${s.port}\r\nConnection: close\r\n\r\n`;
  await conn.write(new TextEncoder().encode(request));
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(4_096);
  for (;;) {
    const read = await conn.read(buffer);
    if (read === null) break;
    chunks.push(buffer.slice(0, read));
  }
  conn.close();
  const raw = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
  assertStringIncludes(raw, ' 421 ');
  await s.close();
});

Deno.test('api requires the token', async () => {
  const s = await startServer({ assets, api: { 'GET /api/ok': () => new Response('yes') } });
  const noTok = await fetch(`http://127.0.0.1:${s.port}/api/ok`);
  assertEquals(noTok.status, 401);
  await noTok.body?.cancel();
  const queryTok = await fetch(`http://127.0.0.1:${s.port}/api/ok?token=${s.token}`);
  assertEquals(queryTok.status, 401);
  await queryTok.body?.cancel();
  const withTok = await fetch(`http://127.0.0.1:${s.port}/api/ok`, { headers: { 'x-mbd-token': s.token } });
  assertEquals(withTok.status, 200);
  assertEquals(await withTok.text(), 'yes');
  await s.close();
});

Deno.test('state-changing routes require the exact loopback Origin', async () => {
  const s = await startServer({ assets, api: { 'POST /api/ok': () => new Response('yes') } });
  const url = `http://127.0.0.1:${s.port}/api/ok`;
  const tokenHeader = { 'x-mbd-token': s.token };
  assertEquals((await fetch(url, { method: 'POST', headers: tokenHeader })).status, 403);
  assertEquals((await fetch(url, {
    method: 'POST',
    headers: { ...tokenHeader, origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
  })).status, 403);
  assertEquals((await fetch(url, {
    method: 'POST', headers: { ...tokenHeader, origin: `http://127.0.0.1:${s.port}` },
  })).status, 200);
  await s.close();
});

Deno.test('a token from a closed session cannot be replayed', async () => {
  const first = await startServer({ assets, api: {} });
  const stale = first.token;
  await first.close();
  const second = await startServer({ assets, api: { 'GET /api/ok': () => new Response('yes') } });
  const response = await fetch(`http://127.0.0.1:${second.port}/api/ok`, { headers: { 'x-mbd-token': stale } });
  assertEquals(response.status, 401);
  await response.body?.cancel();
  await second.close();
});

Deno.test('unknown route 404s', async () => {
  const s = await startServer({ assets, api: {} });
  const res = await fetch(`http://127.0.0.1:${s.port}/api/nope`, { headers: { 'x-mbd-token': s.token } });
  assertEquals(res.status, 404);
  await res.body?.cancel();
  await s.close();
});
