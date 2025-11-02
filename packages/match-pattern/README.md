# MatchPattern

Extended URLPattern for better routing with enhanced search parameter handling.

## Overview

 MatchPattern is a subclass of URLPattern that fixes its limitations for web routing while maintaining full backward compatibility. It enhances URLPattern with order-independent search parameters, unified parameter extraction, and convenient string pattern syntax.

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

## Trailing Slash Normalization

URLPattern has inconsistent behavior with trailing slashes that can cause unexpected matches.

**Issue:** [kenchris/urlpattern-polyfill#131](https://github.com/kenchris/urlpattern-polyfill/issues/131)

**Solution:** ✅ Automatic trailing slash normalization implemented

```javascript
const pattern = new MatchPattern('/api/posts/:id');

// Both match consistently
pattern.test('/api/posts/123');   // ✅ true
pattern.test('/api/posts/123/');  // ✅ true (normalized)
```

## Known Limitations

### Cross-Implementation Differences

The polyfill and native browser implementations can return different results for edge cases.

**Issue:** [kenchris/urlpattern-polyfill#129](https://github.com/kenchris/urlpattern-polyfill/issues/129)

**Impact:** Results may vary between Node.js, browsers, and other runtimes.

**Testing:** Use Playwright for cross-browser validation in production applications.

### TypeScript Compatibility

Node.js and polyfill URLPattern types have slight differences in their TypeScript definitions.

**Issue:** [kenchris/urlpattern-polyfill#135](https://github.com/kenchris/urlpattern-polyfill/issues/135)

**Solution:** MatchPattern uses canonical WHATWG specification types internally.

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

- **Node.js**: 18+ (with URLPattern support) or any version with polyfill
- **Browsers**: Chrome 95+, or any browser with polyfill  
- **Runtimes**: Deno, Bun, Cloudflare Workers, Edge Runtime
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

- URLPattern specification by WHATWG
- [urlpattern-polyfill](https://github.com/kenchris/urlpattern-polyfill) by Ken Christensen
- Web Platform community