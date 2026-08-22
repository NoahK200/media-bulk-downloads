import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { join, normalize, SEPARATOR } from 'jsr:@std/path';
import { containedPath } from '../../src/platform/paths.ts';

Deno.test('containedPath resolves a normal relative path under root', () => {
  const path = containedPath('/root', 'ex.com/video_1.mp4');
  const root = normalize('/root');
  assert(
    path.startsWith(`${root}${SEPARATOR}`),
    `expected path under root, got ${path}`,
  );
  assertEquals(path, join(root, 'ex.com', 'video_1.mp4'));
});

Deno.test('containedPath throws on a traversal that escapes root', () => {
  assertThrows(
    () => containedPath('/root', '../../etc/passwd'),
    Error,
    'refusing path outside root',
  );
});

Deno.test('containedPath throws on a sibling directory sharing a name prefix', () => {
  assertThrows(
    () => containedPath('/root', '../root-sibling/x'),
    Error,
    'refusing path outside root',
  );
});
