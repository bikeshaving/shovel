# Shovel Beta Feedback & Bugs

Feedback from migrating the Crank.js website from Shovel 0.1.x to 0.2.0-beta.0.

## 1. Top-level import of platform-cloudflare in build.ts

**Severity:** Blocker for non-Cloudflare users

**Issue:** `src/commands/build.ts` has a top-level import from `@b9g/platform-cloudflare`:

```typescript
import {
  ...
} from "@b9g/platform-cloudflare";
```

This causes the CLI to fail immediately even when using `--platform bun` or `--platform node`:

```
error: Cannot find module '@b9g/platform-cloudflare' from '/path/to/node_modules/@b9g/shovel/bin/cli.js'
```

**Expected:** Optional peer dependencies should be dynamically imported only when that platform is selected, not at the top level.

**Workaround:** Install `@b9g/platform-cloudflare` even if not targeting Cloudflare.

---

## 2. TypeScript client files not transpiled

**Severity:** Medium

**Issue:** Client-side `.ts` files imported with `assetBase` are copied as-is instead of being transpiled to JavaScript.

The asset manifest shows:
```json
"src/clients/navbar.ts": {
  "source": "src/clients/navbar.ts",
  "output": "navbar-aee34b0d.ts",
  "url": "/static/navbar-aee34b0d.ts",
  "type": "video/mp2t"
}
```

**Expected:**
- Output should be `.js` (transpiled)
- MIME type should be `application/javascript`, not `video/mp2t`

---

## 3. Path resolution after bundling

**Severity:** Medium (may need documentation rather than fix)

**Issue:** Code using `import.meta.url` to resolve relative paths breaks after bundling because the URL points to the bundled output location, not the source location.

Example pattern that breaks:
```typescript
const __dirname = new URL(".", import.meta.url).pathname;
const docs = await collectDocuments(Path.join(__dirname, "../../docs"));
// After bundling, __dirname is dist/server/, not src/
```

**Potential solutions:**
- Provide a Shovel API like `self.sourceDir` or similar
- Document the recommended pattern (e.g., use `process.cwd()` for project-relative paths)
- Inject source paths at build time

---

## Environment

- Shovel version: 0.2.0-beta.0
- Platform: macOS (Darwin 24.3.0)
- Runtime: Bun 1.3.3
- Project: Crank.js website (SSG with Crank for templating)
