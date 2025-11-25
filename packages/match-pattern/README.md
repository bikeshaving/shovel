# MatchPattern

High-performance URLPattern-compatible implementation for web routing with enhanced search parameter handling.

## Overview

MatchPattern is a URLPattern-compatible implementation that compiles patterns directly to RegExp, delivering ~50x faster performance than the URLPattern polyfill while maintaining full spec compliance. It enhances URLPattern with order-independent search parameters, unified parameter extraction, and convenient string pattern syntax.

## Installation

```bash
npm install @b9g/match-pattern
```

## Basic Usage

```javascript
import { MatchPattern } from '@b9g/match-pattern';

// Create patterns with enhanced string syntax
const pattern = new MatchPattern('/api/posts/:id&format=:format');
const url = new URL('http://example.com/api/posts/123?format=json&page=1');

if (pattern.test(url)) {
  const result = pattern.exec(url);
  console.log(result.params); 
  // { id: '123', format: 'json', page: '1' }
}
```

## Performance

MatchPattern compiles patterns directly to optimized RegExp in a single pass, while the URLPattern polyfill uses a multi-stage pipeline (lexer → parser → RegExp generator). This results in **~50x faster** pattern matching:

```javascript
// Benchmark: 1 million matches of /api/:version/posts/:id
// URLPattern polyfill: ~2018ms
// MatchPattern:        ~41ms   (49x faster)

// Complex pattern: /api/:version(v\d+)/posts/:id(\d+)/:slug?
// URLPattern polyfill: ~2230ms
// MatchPattern:        ~47ms   (47x faster)
```

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
pattern.test('/?type=blog&sort=date');  // ✅ Both: true  
pattern.test('/?sort=date&type=blog');  // ✅ MatchPattern: true, URLPattern: false
```

### 2. Non-Exhaustive Search Matching

URLPattern rejects extra parameters. MatchPattern captures them:

```javascript
const pattern = new MatchPattern({ search: 'q=:query' });
const result = pattern.exec('/?q=hello&page=1&limit=10');

// URLPattern: Fails or captures 'hello&page=1&limit=10' as query value
// MatchPattern: { q: 'hello', page: '1', limit: '10' }
console.log(result.params);
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

## Trailing Slash Handling

MatchPattern does not automatically normalize trailing slashes. Use explicit patterns:

```javascript
// Exact matching
const exactPattern = new MatchPattern('/api/posts/:id');
exactPattern.test('/api/posts/123');   // ✅ true
exactPattern.test('/api/posts/123/');  // ❌ false

// Optional trailing slash
const flexiblePattern = new MatchPattern('/api/posts/:id{/}?');
flexiblePattern.test('/api/posts/123');   // ✅ true
flexiblePattern.test('/api/posts/123/');  // ✅ true
```

## Implementation Notes

### Direct RegExp Compilation

MatchPattern compiles URLPattern syntax directly to RegExp in a single pass, while the URLPattern polyfill uses a multi-stage pipeline (lexer → parser → RegExp generator). This approach provides:
- **Performance**: ~50x faster than the URLPattern polyfill
- **Consistency**: Same behavior across all JavaScript runtimes
- **Zero dependencies**: No polyfill required
- **Simplicity**: Direct pattern-to-RegExp compilation with minimal overhead

### URLPattern Spec Compliance

MatchPattern implements the core URLPattern pathname syntax using pure RegExp:
- ✅ Named parameters: `:id`, `:id(\d+)`
- ✅ Optional parameters: `:id?`
- ✅ Repeat modifiers: `:path+`, `:path*`
- ✅ Wildcards: `*`
- ✅ Regex groups: `(\d+)`
- ✅ Explicit delimiters: `{/old}?`
- ✅ Escaped characters: `\.`
- ✅ Protocol and hostname matching
- ✅ Search parameters (with routing enhancements)

**Not implemented:**
- `baseURL` parameter for relative pattern resolution
- Complex hostname wildcards: `{*.}?example.com`
- Port patterns
- Hash patterns

The implementation is validated against comprehensive tests covering the supported pathname and search parameter features.

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

- **Node.js**: All versions (uses standard RegExp)
- **Browsers**: All browsers (no polyfill required)
- **Runtimes**: Deno, Bun, Cloudflare Workers, Edge Runtime, any JavaScript environment
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