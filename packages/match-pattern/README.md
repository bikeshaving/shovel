# MatchPattern

High-performance URLPattern-compatible implementation for web routing with enhanced search parameter handling.

## Overview

This package provides two classes:

- **URLPattern**: A 100% WPT-compliant implementation that's ~60x faster than the polyfill/native
- **MatchPattern**: Same performance with routing enhancements (order-independent search params, unified `params` object)

Both compile patterns directly to RegExp in a single pass, bypassing the multi-stage pipeline used by polyfill/native implementations.

## Installation

```bash
npm install @b9g/match-pattern
```

## Basic Usage

```javascript
import { MatchPattern, URLPattern } from '@b9g/match-pattern';

// URLPattern: 100% WPT-compliant, ~60x faster than polyfill/native
const strict = new URLPattern({ pathname: '/api/posts/:id' });

// MatchPattern: Same performance + order-independent search params
const pattern = new MatchPattern('/api/posts/:id&format=:format');
const url = new URL('http://example.com/api/posts/123?format=json&page=1');

if (pattern.test(url)) {
  const result = pattern.exec(url);
  console.log(result.params);
  // { id: '123', format: 'json', page: '1' }
}
```

## Performance

MatchPattern compiles patterns directly to optimized RegExp in a single pass, while the URLPattern polyfill uses a multi-stage pipeline (lexer → parser → RegExp generator). This results in **~40-60x faster** pattern matching:

| Benchmark | URLPattern | MatchPattern | Polyfill | Native |
|-----------|------------|--------------|----------|--------|
| Static test() | 37ns | 72ns | 3.02µs | 2.32µs |
| Dynamic exec() | 304ns | 483ns | 2.45µs | 2.42µs |
| Construction | 760ns | 634ns | 16.58µs | 16.17µs |

*Benchmarks run on Apple M1, Bun 1.3.3. See `bench/urlpattern.bench.js`.*

MatchPattern adds ~35ns overhead for order-independent search parameter matching - a feature the [URLPattern spec explicitly doesn't support](https://github.com/whatwg/urlpattern/discussions/60).

All URLPattern syntax is fully supported including:
- Named parameters with regex constraints: `:id(\d+)`
- Optional parameters: `:id?`
- Repeat modifiers: `:path+`, `:path*`
- Wildcards: `*`
- Regex groups: `(\d+)`
- Explicit delimiters: `{/old}?`
- Escaped characters: `\.`

## Key Differences from URLPattern

### 1. Order-Independent Search Parameters

URLPattern requires exact parameter order. MatchPattern allows any order:

```javascript
const pattern = new MatchPattern({ search: 'type=:type&sort=:sort' });

// URLPattern: Only first URL matches
// MatchPattern: Both URLs match
pattern.test('/?type=blog&sort=date');  // Both: true
pattern.test('/?sort=date&type=blog');  // MatchPattern: true, URLPattern: false
```

### 2. Non-Exhaustive Search Matching

URLPattern uses greedy capture that lumps extra params into the last parameter value. MatchPattern properly parses them:

```javascript
const pattern = new MatchPattern({ search: 'q=:query' });

// URLPattern greedy capture issue
const urlPattern = new URLPattern({ search: 'q=:query' });
urlPattern.exec('?q=hello&page=1').search.groups;  // { query: "hello&page=1" }

// MatchPattern proper parsing
const result = pattern.exec('/?q=hello&page=1&limit=10');
console.log(result.params);  // { q: 'hello', page: '1', limit: '10' }
```

Required parameters must be present, but extra parameters are allowed:

```javascript
pattern.test('/search');                         // false (q missing)
pattern.test('/search?q=hello');                 // true
pattern.test('/search?q=hello&page=1&limit=10'); // true (extras captured)
```

### 3. Unified Parameter Object

URLPattern separates pathname and search groups. MatchPattern merges everything:

```javascript
const pattern = new MatchPattern('/api/:version/posts/:id&format=:format');
const result = pattern.exec('/api/v1/posts/123?format=json&page=1');

// URLPattern: result.pathname.groups + result.search.groups (separate)
// MatchPattern: result.params (unified)
console.log(result.params); // { version: 'v1', id: '123', format: 'json', page: '1' }
```

### 4. Enhanced String Pattern Syntax

MatchPattern supports convenient string patterns with `&` separator:

```javascript
// Pathname only
new MatchPattern('/api/posts/:id')

// Pathname with search parameters
new MatchPattern('/api/posts/:id&format=:format&page=:page')

// Search parameters only
new MatchPattern('&q=:query&sort=:sort')

// Full URL patterns
new MatchPattern('https://api.example.com/v1/posts/:id&format=:format')

// Object syntax (same as URLPattern, enhanced behavior)
new MatchPattern({
  pathname: '/api/posts/:id',
  search: 'format=:format'
})
```

It's not possible to separate pathname from search with `?` because the syntax is used to indicate optionality.

## Trailing Slash Handling

MatchPattern does not automatically normalize trailing slashes. Use explicit patterns:

```javascript
// Exact matching
const exactPattern = new MatchPattern('/api/posts/:id');
exactPattern.test('/api/posts/123');   // true
exactPattern.test('/api/posts/123/');  // false

// Optional trailing slash
const flexiblePattern = new MatchPattern('/api/posts/:id{/}?');
flexiblePattern.test('/api/posts/123');   // true
flexiblePattern.test('/api/posts/123/');  // true
```

## Implementation Notes

### Direct RegExp Compilation

MatchPattern compiles URLPattern syntax directly to RegExp in a single pass, while the URLPattern polyfill uses a multi-stage pipeline (lexer → parser → RegExp generator). This approach provides:
- **Performance**: ~40-60x faster than the URLPattern polyfill and native implementations
- **Consistency**: Same behavior across all JavaScript runtimes
- **Zero dependencies**: No polyfill required
- **Simplicity**: Direct pattern-to-RegExp compilation with minimal overhead

### URLPattern Spec Compliance

The `URLPattern` class passes 100% of the Web Platform Tests (755 tests). It implements the full URLPattern specification:

- Named parameters: `:id`, `:id(\d+)`
- Optional parameters: `:id?`
- Repeat modifiers: `:path+`, `:path*`
- Wildcards: `*`
- Regex groups: `(\d+)`
- Explicit delimiters: `{/old}?`
- Escaped characters: `\.`
- Protocol, hostname, port, pathname, search, and hash matching
- baseURL parameter for relative pattern resolution
- ignoreCase option

`MatchPattern` intentionally deviates from strict spec compliance in two areas to provide better routing ergonomics:
- Allows relative patterns without baseURL (convenience for routing)
- Order-independent search parameter matching

## API Reference

### Constructor

```typescript
new MatchPattern(input: string | URLPatternInit, baseURL?: string)
```

### Methods

```typescript
// Enhanced methods with unified params
test(input: string | URL): boolean
exec(input: string | URL): MatchPatternResult | null
```

### Types

```typescript
interface MatchPatternResult extends URLPatternResult {
  params: Record<string, string>;  // Unified parameters from all sources
}
```

## Compatibility

- **Runtimes**: Node, Deno, Bun, Cloudflare Workers, Edge Runtime, any JavaScript environment
- **Browsers**: All browsers (no polyfill required)
- **TypeScript**: 5.0+ recommended

## Contributing

MatchPattern follows the [WHATWG URLPattern specification](https://urlpattern.spec.whatwg.org/) while extending it for routing use cases.

Report issues related to:
- URLPattern compatibility problems
- Performance issues with complex patterns
- Cross-runtime behavior differences

## License

MIT - see LICENSE file for details.

## Acknowledgments

- [URLPattern specification](https://urlpattern.spec.whatwg.org/) by WHATWG
- Inspired by [path-to-regexp](https://github.com/pillarjs/path-to-regexp) and the URLPattern spec
- Web Platform community
