/**
 * Module resolution hook for running these tests with `node --test`.
 *
 * The project compiles with `"moduleResolution": "bundler"`, so source files
 * import siblings without a file extension (`./guards`, not `./guards.ts`).
 * Node's ESM resolver requires the extension, and `allowImportingTsExtensions`
 * is off in tsconfig.json — so the imports cannot simply be rewritten without
 * breaking `tsc --noEmit`.
 *
 * This hook closes the gap: try Node's normal resolution first, then retry
 * with `.ts` and `/index.ts` appended. It lives here, next to the tests, so
 * nothing outside `lib/spotify/**` has to change.
 *
 * Run the suite with:
 *   node --test --experimental-strip-types \
 *        --import ./lib/spotify/__tests__/ts-resolve-hook.mjs \
 *        lib/spotify/__tests__/*.test.ts
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const HOOK_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;
    for (const suffix of ['.ts', '/index.ts', '.tsx']) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        // try the next candidate
      }
    }
    throw error;
  }
}
`;

register(`data:text/javascript,${encodeURIComponent(HOOK_SOURCE)}`, pathToFileURL('./'));
