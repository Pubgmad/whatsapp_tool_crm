/**
 * Server boot hook — keep Node job runners free of browser-only globals
 * accidentally required by PDF tooling pulled into shared server graphs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {}
    };
  }
}
