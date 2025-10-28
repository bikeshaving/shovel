# @b9g/import-with-type-url

ESBuild and (hopefully) Bun plugin for importing static assets as URLs using
[import attributes](https://github.com/tc39/proposal-import-attributes).

## Features

- Works with ESBuild
- Import any file as a public URL string
- Content-based hashing for cache busting
- Automatic asset copying to output directory
- Zero runtime overhead - URLs inlined at build time
- Supports static and dynamic imports (when bundling)

## Installation

```bash
bun install @b9g/import-with-type-url
```

## Usage

### ESBuild

```js
import {build} from 'esbuild';
import {importWithTypeUrl} from '@b9g/import-with-type-url';

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  outdir: 'dist',
  plugins: [
    importWithTypeUrl({
      outputDir: 'dist/assets',
      publicPath: '/assets/',
      hashLength: 8
    }),
  ],
});
```

### Bun

🚨 Bun doesn't support import attributes in the plugin API yet
```js
import {importWithTypeUrl} from '@b9g/import-with-type-url';

await Bun.build({
  entrypoints: ['./src/index.js'],
  outdir: './dist',
  plugins: [
    importWithTypeUrl()
  ]
});
```

### In Your Code

```js
// Import any asset as a URL
import logo from './logo.svg' with {type: 'url'};
import stylesheet from './styles.css' with {type: 'url'};
import image from './hero.jpg' with {type: 'url'};

console.log(logo);
// Output: "/assets/logo-abc12345.svg"

// Use in HTML
document.body.innerHTML = `
  <img src="${image}" alt="Hero">
  <link rel="stylesheet" href="${stylesheet}">
`;

// Dynamic imports (when bundling)
const icon = await import('./icon.png', {
  with: {type: 'url'}
}).then(m => m.default);
```

## Options

| Option        | Type      | Default         | Example                             |
|---------------|-----------|-----------------|-------------------------------------|
| `outputDir`   | `string`  | `'dist/assets'` | Directory to output assets          |
| `publicPath`  | `string`  | `'/assets/'`    | Public URL path prefix              |
| `hashLength`  | `number`  | `8`             | Length of content hash              |

### Examples

```js
// Custom output directory and public path
importWithTypeUrl({
  outputDir: 'public/static',
  publicPath: '/static/'
})
// Result: "/static/logo-abc12345.svg"

// No hashing (not recommended for production)
importWithTypeUrl({
  includeHash: false
})
// Result: "/assets/logo.svg"

// Longer hash for extra uniqueness
importWithTypeUrl({
  hashLength: 16
})
// Result: "/assets/logo-abc123456789def0.svg"
```

## How It Works

1. **Build time**: Plugin intercepts imports with `{type: 'url'}`
2. **Hash generation**: Creates content-based hash of the file
3. **File copying**: Copies asset to output directory with hashed name
4. **URL inlining**: Replaces import with the public URL string
5. **Zero runtime**: No runtime code needed, just a string constant

```js
// This code:
import logo from './logo.svg' with { type: 'url' };

// Becomes this after bundling:
const logo = "/assets/logo-abc12345.svg";
```

## Comparison with Other Approaches

### vs. Vite's `?url`

```js
// Vite
import logo from './logo.svg?url';

// This plugin (standard import attributes)
import logo from './logo.svg' with { type: 'url' };
```

**Advantages:**
- Uses standard JavaScript import attributes
- Works with any bundler that supports the standard
- More explicit type declaration

### vs. ESBuild's `file` loader

```js
// ESBuild file loader (via config)
import logo from './logo.svg'; // Returns: "./logo-abc.svg"

// This plugin
import logo from './logo.svg' with {type: 'url'}; // Returns: "/assets/logo-abc.svg"
```

**Advantages:**
- Explicit opt-in per import (no global config needed)
- Configurable public path
- Co-exists with other loaders

### vs. ESBuild's `dataurl` loader

```js
// ESBuild dataurl loader
import logo from './logo.svg'; // Returns: "data:image/svg+xml;base64,..."

// This plugin
import logo from './logo.svg' with { type: 'url' }; // Returns: "/assets/logo-abc.svg"
```

**Advantages:**
- Smaller bundle size (no inline base64)
- Better caching (separate HTTP requests)
- Works for large assets

## TypeScript Support

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Create a `global.d.ts`:

```typescript
declare module '*' {
  const content: string;
  export default content;
}

// Or more specific:
declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.jpg' {
  const url: string;
  export default url;
}

declare module '*.css' {
  const url: string;
  export default url;
}
```

## Limitations

- **Dynamic imports in non-bundled code**: Import attributes on dynamic imports may not work in all runtimes when not bundling
- **Dev server HMR**: Asset changes won't trigger HMR without additional tooling
- **Source maps**: Asset origins aren't tracked in source maps

## Use Cases

### Static Site Generation (SSG)

```js
// Build-time asset processing
import heroImage from './hero.jpg' with {type: 'url'};

const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>My Site</title>
    </head>
    <body>
      <img src="${heroImage}" alt="Hero">
    </body>
  </html>
`;
```

### Component Libraries

```js
// Distribute components with bundled assets
export function Logo() {
  const logoUrl = await import('./logo.svg', {
    with: {type: 'url'}
  }).then(m => m.default);

  return `<img src="${logoUrl}" alt="Logo">`;
}
```

### Universal Rendering

```js
// Same asset handling for client and server
import icon from './icon.png' with {type: 'url'};

// Server-side
const html = `<link rel="icon" href="${icon}">`;

// Client-side
document.querySelector('link[rel=icon]').href = icon;
```

## Requirements

- ESBuild >= 0.19.7 (for import attributes support)
- Node.js >= 18 (for native import attributes)

## License

MIT

## Related

- [Import Attributes Proposal](https://github.com/tc39/proposal-import-attributes)
- [ESBuild Import Attributes](https://esbuild.github.io/api/#how-import-attributes-work)
- [Shovel Framework](https://github.com/b9g/shovel) - Cache-first universal framework using this plugin
