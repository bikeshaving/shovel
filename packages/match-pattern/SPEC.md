# MatchPattern Specification

## Overview

MatchPattern is a subclass of URLPattern that fixes its limitations for web routing scenarios. It maintains full compatibility with URLPattern while adding enhanced functionality for better developer experience.

## Core Principles

1. **Backward Compatible**: MatchPattern extends URLPattern, doesn't replace it
2. **Order-Independent**: Search parameters can be in any order
3. **Non-Exhaustive Matching**: Extra search parameters are allowed and captured
4. **Unified Parameters**: All captured parameters merged into single `params` object
5. **Enhanced String Parsing**: Support for convenient string pattern formats

## Constructor API

```typescript
class MatchPattern extends URLPattern {
  constructor(input: string | URLPatternInit, baseURL?: string)
}

// string: Enhanced string parsing with & syntax
// URLPatternInit: Same object format as URLPattern, with enhanced matching behavior
```

### String Pattern Formats

MatchPattern supports multiple convenient string formats using `&` to separate search parameters:

```javascript
// 1. Pathname only
new MatchPattern('/api/posts/:id')

// 2. Pathname with search params  
new MatchPattern('/api/posts/:id&format=:format&page=:page')

// 3. Full URL with parameters
new MatchPattern('https://api.example.com/v1/posts/:id&format=:format')

// 4. Search params only
new MatchPattern('&q=:query&page=:page')

// 5. Complex patterns
new MatchPattern('/search&q=:query&page=:page&sort=:sort')

// 6. Object format (enhanced URLPattern)
new MatchPattern({
  pathname: '/api/posts/:id',
  search: 'format=:format'  // Non-exhaustive by default
})
```

## Enhanced Matching Behavior

### Search Parameter Order Independence

```javascript
const pattern = new MatchPattern({ search: 'type=:type&sort=:sort' });

// Both match (order doesn't matter)
pattern.test('/test?type=blog&sort=date');  // ✅ true
pattern.test('/test?sort=date&type=blog');  // ✅ true (URLPattern: ❌ false)
```

### Proper Search Parameter Parsing

```javascript
const pattern = new MatchPattern({ search: 'q=:query' });

// URLPattern greedy capture issue
const urlPattern = new URLPattern({ search: 'q=:query' });
urlPattern.exec('?q=hello&page=1').search.groups;  // { query: "hello&page=1" } 😱

// MatchPattern proper parsing  
const matchPattern = new MatchPattern({ search: 'q=:query' });
matchPattern.exec('?q=hello&page=1').params;       // { q: "hello", page: "1" } ✅
```

### Required Parameters with Extra Parameter Support

```javascript
const pattern = new MatchPattern({ search: 'q=:query' });

// Required parameters must be present
pattern.test('/search');                        // ❌ false (q missing)
pattern.test('/search?q=hello');                // ✅ true (q present)

// Extra parameters are allowed and captured  
pattern.test('/search?q=hello&page=1');         // ✅ true 
pattern.test('/search?q=hello&page=1&limit=10'); // ✅ true
```

### Unified Parameter Extraction

```javascript
const pattern = new MatchPattern('/api/:version/posts/:id&format=:format');
const url = new URL('http://example.com/api/v1/posts/123?format=json&page=1');
const result = pattern.exec(url);

// MatchPattern provides unified params
result.params = {
  version: 'v1',      // from pathname
  id: '123',          // from pathname  
  format: 'json',     // from search (parameterized)
  page: '1'           // from search (extra param)
}

// URLPattern data still available
result.pathname.groups = { version: 'v1', id: '123' }
result.search.groups = { format: 'json' }
```

## Enhanced Exec Result

```typescript
interface MatchPatternResult extends URLPatternResult {
  params: Record<string, string>;  // Unified parameters from all sources
}
```

The `params` object combines:
- **Pathname parameters**: `:id`, `:version`, etc.
- **Search parameters**: `format=:format` captures  
- **Extra search parameters**: Non-parameterized query params
- **Hash parameters**: `#section=:section` captures (if specified)

## Key Differences from URLPattern

MatchPattern fixes URLPattern's routing limitations:

1. **Search parameter order independence** - URLPattern requires exact order
2. **Proper search parameter parsing** - URLPattern uses greedy capture that lumps extra params into the last parameter value
3. **Unified parameter extraction** - URLPattern separates pathname/search groups, no unified params object
4. **Enhanced string parsing** - URLPattern requires object syntax for complex patterns  

MatchPattern uses URLPattern's existing syntax (`:param`, `:param?`, `*`, etc.) but with proper parsing and matching behavior for routing.

## Compatibility with URLPattern

MatchPattern maintains full URLPattern compatibility:

```javascript
// All URLPattern features work unchanged
const pattern = new MatchPattern({
  protocol: 'https',
  hostname: 'api.example.com',
  pathname: '/v1/posts/:id',
  search: 'format=:format'
});

// URLPattern methods work identically
pattern.test(url);           // Same behavior as URLPattern
pattern.exec(url);           // Enhanced result with .params
pattern.pathname;            // Same as URLPattern  
pattern.search;              // Same as URLPattern
```

## Implementation Strategy

### Phase 1: Basic Enhancement
- [x] Extend URLPattern class
- [x] Add unified `params` extraction  
- [x] Implement order-independent search matching
- [x] Add non-exhaustive search parameter support

### Phase 2: String Pattern Parsing
- [ ] Parse pathname-only patterns: `/api/posts/:id`
- [ ] Parse query string patterns: `/search&q=:query`  
- [ ] Parse full URL patterns: `https://api.example.com/posts/:id`
- [ ] Handle baseURL parameter for relative patterns

### Phase 3: Advanced Features
- [ ] Optional parameter syntax: `:param?`
- [ ] Wildcard parameter syntax: `*`
- [ ] Hash parameter support: `#section=:section`
- [ ] Pattern validation and error handling

## Error Handling

MatchPattern should provide clear error messages for invalid patterns:

```javascript
// Invalid syntax
new MatchPattern('/api/:id:invalid');     // SyntaxError: Invalid parameter syntax
new MatchPattern('&query=:');            // SyntaxError: Incomplete parameter name
new MatchPattern('/api/&=:value');       // SyntaxError: Missing parameter name
```

## Performance Considerations

- **Caching**: Pre-compile patterns for repeated matching
- **Lazy Evaluation**: Only parse complex patterns when needed  
- **Backward Compatibility**: Delegate to URLPattern when possible
- **Memory Efficient**: Reuse URLPattern instances internally

## Use Cases

### Router Integration
```javascript
// Shovel router usage
router.route({
  pattern: new MatchPattern('/api/posts/:id&format=:format'),
  methods: ['GET']
}, async (request, context) => {
  // context.params = { id: '123', format: 'json', page: '1' }
  const { id, format = 'html' } = context.params;
});
```

### Flexible API Endpoints
```javascript
// API with optional pagination
const pattern = new MatchPattern('/api/posts&page=:page?&limit=:limit?');

// All these match:
// /api/posts
// /api/posts?page=1  
// /api/posts?limit=10
// /api/posts?page=1&limit=10&sort=date
```

### Multi-Version APIs
```javascript
// Version-aware routing
const pattern = new MatchPattern('https://api.example.com/:version/posts/:id');
// Matches: https://api.example.com/v1/posts/123
//          https://api.example.com/v2/posts/456
```

This specification defines a URLPattern enhancement that maintains compatibility while fixing the key limitations for web routing scenarios.