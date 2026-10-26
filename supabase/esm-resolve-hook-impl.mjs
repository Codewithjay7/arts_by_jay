/**
 * The resolver itself, run on Node's module-loader thread.
 *
 * Only relative specifiers are touched, and only when they do not already
 * resolve. Bare package names are left entirely alone so node_modules
 * resolution is unaffected.
 */

import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The order Vite tries, for a specifier that has no extension.
const CANDIDATES = ['.js', '.jsx', '.mjs', '/index.js', '/index.jsx'];

export const resolve = (specifier, context, nextResolve) => {
  if (specifier.startsWith('.') && context.parentURL) {
    let asUrl;
    try {
      asUrl = new URL(specifier, context.parentURL);
    } catch {
      return nextResolve(specifier, context);
    }

    const asPath = fileURLToPath(asUrl);

    // Already a real file: nothing to do.
    const isFile = existsSync(asPath) && statSync(asPath).isFile();

    if (!isFile) {
      for (const suffix of CANDIDATES) {
        const candidate = asPath + suffix;
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true, format: 'module' };
        }
      }
    }
  }

  return nextResolve(specifier, context);
};
