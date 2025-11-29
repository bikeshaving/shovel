# Shovel Beta Feedback & Bugs

Feedback from migrating the Crank.js website from Shovel 0.1.x to 0.2.0-beta.0.

## 1. ~~Top-level import of platform-cloudflare in build.ts~~ ✅ FIXED

**Status:** Fixed - `@b9g/platform-cloudflare` is now dynamically imported only when `--platform cloudflare` is selected.

---

## 2. ~~TypeScript client files not transpiled~~ ✅ FIXED

**Status:** Fixed - `.ts`, `.tsx`, `.jsx`, `.mts`, `.cts` files are now transpiled to JavaScript with correct `application/javascript` MIME type.

---

## 3. ~~Path resolution after bundling~~ ✅ FIXED

**Status:** Fixed - `import.meta.url`, `import.meta.dirname`, and `import.meta.filename` are now transformed to source paths at build time via `importMetaPlugin()`. The "principle of least surprise" - developers expect these APIs to reference where they wrote their code, not where the bundle executes from.

---

## 4. ~~Client bundles need Node.js polyfills for browser-based transforms~~ ✅ FIXED

**Status:** Fixed in @b9g/assets - Node.js polyfills are now included by default

**Solution:** Client bundles now automatically include Node.js polyfills using:
- `@esbuild-plugins/node-modules-polyfill` - polyfills Node core modules (buffer, path, etc.)
- `@esbuild-plugins/node-globals-polyfill` - polyfills global objects (process, Buffer)

No configuration needed - polyfills are applied automatically when bundling TypeScript/JSX client assets.

---

## Environment

- Shovel version: 0.2.0-beta.2
- Platform: macOS (Darwin 24.3.0)
- Runtime: Bun 1.3.3
- Project: Crank.js website (SSG with Crank for templating)
