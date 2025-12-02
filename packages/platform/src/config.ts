/**
 * Configuration expression parser
 *
 * Embeddable JavaScript-like expressions for JSON config:
 * - ALL_CAPS = env var reference (e.g., NODE_ENV, PORT)
 * - Everything else = string literal (kebab-case, URLs, camelCase, PascalCase)
 * - Quoted strings = explicit strings (escape hatch)
 * - JavaScript keywords: true, false, null, undefined
 * - Operators: ||, &&, ===, !==, ==, !=, ? :, !
 * - No eval - uses recursive descent parser
 *
 * Examples:
 *   "PORT || 3000"
 *   "NODE_ENV === production ? redis : memory"
 *   "REDIS_URL || redis://localhost:6379"
 *   "S3_BUCKET || my-bucket-name"
 *   "BASE_PATH || ./uploads"
 */

import {readFileSync} from "fs";
import {resolve} from "path";
import {Cache} from "@b9g/cache";
import {configure, getConsoleSink, type LogLevel as LogTapeLevel} from "@logtape/logtape";

/**
 * Get environment variables from import.meta.env or process.env
 */
function getEnv(): Record<string, string | undefined> {
	// Prefer import.meta.env (Vite, Deno, modern runtimes)
	if (typeof import.meta !== "undefined" && import.meta.env) {
		return import.meta.env as Record<string, string | undefined>;
	}
	// Fallback to process.env (Node.js)
	// eslint-disable-next-line no-restricted-properties
	if (typeof process !== "undefined" && process.env) {
		// eslint-disable-next-line no-restricted-properties
		return process.env;
	}
	// No env available
	return {};
}

// ============================================================================
// TOKENIZER
// ============================================================================

enum TokenType {
	// Literals
	STRING = "STRING",
	NUMBER = "NUMBER",
	TRUE = "TRUE",
	FALSE = "FALSE",
	NULL = "NULL",
	UNDEFINED = "UNDEFINED",
	IDENTIFIER = "IDENTIFIER",

	// Operators
	QUESTION = "?",
	COLON = ":",
	OR = "||",
	AND = "&&",
	EQ = "==",
	NE = "!=",
	EQ_STRICT = "===",
	NE_STRICT = "!==",
	NOT = "!",

	// Grouping
	LPAREN = "(",
	RPAREN = ")",

	EOF = "EOF",
}

interface Token {
	type: TokenType;
	value: any;
	start: number;
	end: number;
}

class Tokenizer {
	#input: string;
	#pos: number;

	constructor(input: string) {
		this.#input = input;
		this.#pos = 0;
	}

	#peek(): string {
		return this.#input[this.#pos] || "";
	}

	#advance(): string {
		return this.#input[this.#pos++] || "";
	}

	#skipWhitespace(): void {
		while (/\s/.test(this.#peek())) {
			this.#advance();
		}
	}

	next(): Token {
		this.#skipWhitespace();

		const start = this.#pos;
		const ch = this.#peek();

		// EOF
		if (!ch) {
			return {type: TokenType.EOF, value: null, start, end: start};
		}

		// Quoted strings
		if (ch === '"') {
			this.#advance(); // consume "
			let value = "";
			while (this.#peek() && this.#peek() !== '"') {
				if (this.#peek() === "\\") {
					this.#advance();
					const next = this.#advance();
					// Simple escape handling
					if (next === "n") value += "\n";
					else if (next === "t") value += "\t";
					else value += next;
				} else {
					value += this.#advance();
				}
			}
			if (this.#peek() !== '"') {
				throw new Error(`Unterminated string at position ${start}`);
			}
			this.#advance(); // consume closing "
			return {type: TokenType.STRING, value, start, end: this.#pos};
		}

		// Numbers
		if (/\d/.test(ch)) {
			let value = "";
			while (/\d/.test(this.#peek())) {
				value += this.#advance();
			}
			return {
				type: TokenType.NUMBER,
				value: parseInt(value, 10),
				start,
				end: this.#pos,
			};
		}

		// Operators (multi-char)
		if (
			ch === "=" &&
			this.#input[this.#pos + 1] === "=" &&
			this.#input[this.#pos + 2] === "="
		) {
			this.#pos += 3;
			return {type: TokenType.EQ_STRICT, value: "===", start, end: this.#pos};
		}
		if (
			ch === "!" &&
			this.#input[this.#pos + 1] === "=" &&
			this.#input[this.#pos + 2] === "="
		) {
			this.#pos += 3;
			return {type: TokenType.NE_STRICT, value: "!==", start, end: this.#pos};
		}
		if (ch === "=" && this.#input[this.#pos + 1] === "=") {
			this.#pos += 2;
			return {type: TokenType.EQ, value: "==", start, end: this.#pos};
		}
		if (ch === "!" && this.#input[this.#pos + 1] === "=") {
			this.#pos += 2;
			return {type: TokenType.NE, value: "!=", start, end: this.#pos};
		}
		if (ch === "|" && this.#input[this.#pos + 1] === "|") {
			this.#pos += 2;
			return {type: TokenType.OR, value: "||", start, end: this.#pos};
		}
		if (ch === "&" && this.#input[this.#pos + 1] === "&") {
			this.#pos += 2;
			return {type: TokenType.AND, value: "&&", start, end: this.#pos};
		}

		// Single-char operators
		if (ch === "?") {
			this.#advance();
			return {type: TokenType.QUESTION, value: "?", start, end: this.#pos};
		}
		if (ch === "!") {
			this.#advance();
			return {type: TokenType.NOT, value: "!", start, end: this.#pos};
		}
		if (ch === "(") {
			this.#advance();
			return {type: TokenType.LPAREN, value: "(", start, end: this.#pos};
		}
		if (ch === ")") {
			this.#advance();
			return {type: TokenType.RPAREN, value: ")", start, end: this.#pos};
		}

		// Colon - only tokenize as operator when it's for ternary (not URLs/ports)
		// Don't tokenize : if followed by / (://) or digit (:6379)
		if (ch === ":") {
			const next = this.#input[this.#pos + 1];
			if (next !== "/" && !/\d/.test(next)) {
				this.#advance();
				return {type: TokenType.COLON, value: ":", start, end: this.#pos};
			}
		}

		// Identifiers and literals
		// Catchall: consume everything that's not whitespace or an operator
		// This naturally handles: kebab-case, URLs, paths, env vars, camelCase, etc.
		if (/\S/.test(ch) && !/[?!()=|&]/.test(ch)) {
			let value = "";
			while (/\S/.test(this.#peek()) && !/[?!()=|&]/.test(this.#peek())) {
				// Stop at : only if it's ternary context (not :// or :port)
				if (this.#peek() === ":") {
					const next = this.#input[this.#pos + 1];
					if (next !== "/" && !/\d/.test(next)) {
						break; // Ternary colon
					}
				}
				value += this.#advance();
			}

			// Keywords
			if (value === "true")
				return {type: TokenType.TRUE, value: true, start, end: this.#pos};
			if (value === "false")
				return {type: TokenType.FALSE, value: false, start, end: this.#pos};
			if (value === "null")
				return {type: TokenType.NULL, value: null, start, end: this.#pos};
			if (value === "undefined")
				return {
					type: TokenType.UNDEFINED,
					value: undefined,
					start,
					end: this.#pos,
				};

			// Identifier (env var or string literal)
			return {type: TokenType.IDENTIFIER, value, start, end: this.#pos};
		}

		throw new Error(`Unexpected character '${ch}' at position ${start}`);
	}
}

// ============================================================================
// PARSER
// ============================================================================

class Parser {
	#tokens: Token[];
	#pos: number;
	#env: Record<string, string | undefined>;
	#strict: boolean;

	constructor(
		input: string,
		env: Record<string, string | undefined>,
		strict: boolean,
	) {
		const tokenizer = new Tokenizer(input);
		this.#tokens = [];
		let token;
		do {
			token = tokenizer.next();
			this.#tokens.push(token);
		} while (token.type !== TokenType.EOF);

		this.#pos = 0;
		this.#env = env;
		this.#strict = strict;
	}

	#peek(): Token {
		return this.#tokens[this.#pos];
	}

	#advance(): Token {
		return this.#tokens[this.#pos++];
	}

	#expect(type: TokenType): Token {
		const token = this.#peek();
		if (token.type !== type) {
			throw new Error(
				`Expected ${type} but got ${token.type} at position ${token.start}`,
			);
		}
		return this.#advance();
	}

	parse(): any {
		const result = this.#parseExpr();
		this.#expect(TokenType.EOF);
		return result;
	}

	// Expr := Ternary
	#parseExpr(): any {
		return this.#parseTernary();
	}

	// Ternary := LogicalOr ('?' Expr ':' Expr)?
	#parseTernary(): any {
		let left = this.#parseLogicalOr();

		if (this.#peek().type === TokenType.QUESTION) {
			this.#advance(); // consume ?
			const trueBranch = this.#parseExpr();
			this.#expect(TokenType.COLON);
			const falseBranch = this.#parseExpr();
			return left ? trueBranch : falseBranch;
		}

		return left;
	}

	// LogicalOr := LogicalAnd ('||' LogicalAnd)*
	#parseLogicalOr(): any {
		let left = this.#parseLogicalAnd();

		while (this.#peek().type === TokenType.OR) {
			this.#advance(); // consume ||
			const right = this.#parseLogicalAnd();
			left = left || right;
		}

		return left;
	}

	// LogicalAnd := Equality ('&&' Equality)*
	#parseLogicalAnd(): any {
		let left = this.#parseEquality();

		while (this.#peek().type === TokenType.AND) {
			this.#advance(); // consume &&
			const right = this.#parseEquality();
			left = left && right;
		}

		return left;
	}

	// Equality := Unary (('===' | '!==' | '==' | '!=') Unary)*
	#parseEquality(): any {
		let left = this.#parseUnary();

		while (true) {
			const token = this.#peek();

			if (token.type === TokenType.EQ_STRICT) {
				this.#advance();
				const right = this.#parseUnary();
				left = left === right;
			} else if (token.type === TokenType.NE_STRICT) {
				this.#advance();
				const right = this.#parseUnary();
				left = left !== right;
			} else if (token.type === TokenType.EQ) {
				this.#advance();
				const right = this.#parseUnary();
				left = left == right;
			} else if (token.type === TokenType.NE) {
				this.#advance();
				const right = this.#parseUnary();
				left = left != right;
			} else {
				break;
			}
		}

		return left;
	}

	// Unary := '!' Unary | Primary
	#parseUnary(): any {
		if (this.#peek().type === TokenType.NOT) {
			this.#advance(); // consume !
			return !this.#parseUnary();
		}

		return this.#parsePrimary();
	}

	// Primary := EnvVar | Literal | '(' Expr ')'
	#parsePrimary(): any {
		const token = this.#peek();

		// Parenthesized expression
		if (token.type === TokenType.LPAREN) {
			this.#advance(); // consume (
			const value = this.#parseExpr();
			this.#expect(TokenType.RPAREN);
			return value;
		}

		// Literals
		if (token.type === TokenType.STRING) {
			this.#advance();
			return token.value;
		}
		if (token.type === TokenType.NUMBER) {
			this.#advance();
			return token.value;
		}
		if (token.type === TokenType.TRUE) {
			this.#advance();
			return true;
		}
		if (token.type === TokenType.FALSE) {
			this.#advance();
			return false;
		}
		if (token.type === TokenType.NULL) {
			this.#advance();
			return null;
		}
		if (token.type === TokenType.UNDEFINED) {
			this.#advance();
			return undefined;
		}

		// Identifier (env var or string literal)
		if (token.type === TokenType.IDENTIFIER) {
			this.#advance();
			const name = token.value;

			// Check if it's ALL_CAPS (env var)
			if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
				const value = this.#env[name];

				// Strict mode: error if undefined and not in safe context
				if (this.#strict && value === undefined) {
					// We're in a safe context if we're being called from || or && or == null
					// But we can't know that here without more context tracking
					// For now, just error - the calling code can use {strict: false} if needed
					throw new Error(
						`Undefined environment variable: ${name}\n` +
							`Fix:\n` +
							`  1. Set the env var: export ${name}=value\n` +
							`  2. Add a fallback: ${name} || defaultValue\n` +
							`  3. Add null check: ${name} == null ? ... : ...\n` +
							`  4. Use empty string for falsy: export ${name}=""`,
					);
				}

				// Auto-convert numeric strings to numbers
				if (typeof value === "string" && /^\d+$/.test(value)) {
					return parseInt(value, 10);
				}

				return value;
			}

			// Otherwise it's a string literal (kebab-case, URL, camelCase, etc.)
			return name;
		}

		throw new Error(
			`Unexpected token ${token.type} at position ${token.start}`,
		);
	}
}

/**
 * Parse a configuration expression with the DSL
 */
export function parseConfigExpr(
	expr: string,
	env: Record<string, string | undefined> = getEnv(),
	options: {strict?: boolean} = {},
): any {
	const strict = options.strict !== false; // default true

	try {
		const parser = new Parser(expr, env, strict);
		return parser.parse();
	} catch (error) {
		throw new Error(
			`Invalid config expression: ${expr}\n` +
				`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Process a config value (handles nested objects/arrays)
 */
export function processConfigValue(
	value: any,
	env: Record<string, string | undefined> = getEnv(),
	options: {strict?: boolean} = {},
): any {
	if (typeof value === "string") {
		// Check if it looks like an expression (contains operators or env vars)
		// Operators: ||, &&, ===, !==, ==, !=, ?, :, !
		// Env vars: ALL_CAPS identifiers
		if (/(\|\||&&|===|!==|==|!=|[?:!]|^[A-Z][A-Z0-9_]*$)/.test(value)) {
			return parseConfigExpr(value, env, options);
		}
		// Plain string
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => processConfigValue(item, env, options));
	}

	if (value !== null && typeof value === "object") {
		const processed: any = {};
		for (const [key, val] of Object.entries(value)) {
			processed[key] = processConfigValue(val, env, options);
		}
		return processed;
	}

	return value;
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================

/**
 * Match a name against config patterns
 *
 * Priority:
 * 1. Exact match: "sessions" matches "sessions"
 * 2. Prefix patterns: "api-*" matches "api-v1", "api-v2" (longest first)
 * 3. Catch-all: "*" matches everything
 *
 * Examples:
 *   matchPattern("sessions", {"sessions": {...}, "*": {...}})  → sessions config
 *   matchPattern("api-v1", {"api-*": {...}, "*": {...}})       → api-* config
 *   matchPattern("random", {"*": {...}})                        → * config
 */
export function matchPattern<T>(
	name: string,
	config: Record<string, T>,
): T | undefined {
	// 1. Exact match
	if (config[name]) {
		return config[name];
	}

	// 2. Collect matching patterns (excluding catch-all)
	const patterns: Array<{pattern: string; config: T; prefixLength: number}> =
		[];

	for (const [pattern, cfg] of Object.entries(config)) {
		if (pattern === "*") continue; // Handle catch-all last

		if (pattern.endsWith("*")) {
			const prefix = pattern.slice(0, -1);
			if (name.startsWith(prefix)) {
				patterns.push({
					pattern,
					config: cfg,
					prefixLength: prefix.length,
				});
			}
		}
	}

	// Return longest matching prefix (most specific)
	if (patterns.length > 0) {
		patterns.sort((a, b) => b.prefixLength - a.prefixLength);
		return patterns[0].config;
	}

	// 3. Catch-all
	return config["*"];
}

// ============================================================================
// CONFIG SCHEMA
// ============================================================================

export interface CacheConfig {
	provider?: string | number;
	url?: string | number;
	maxEntries?: string | number;
	TTL?: string | number;
}

export interface BucketConfig {
	provider?: string | number;
	path?: string | number;
	bucket?: string | number;
	region?: string | number;
	endpoint?: string | number;
}

/** Log level for filtering */
export type LogLevel = "debug" | "info" | "warning" | "error";

export interface LoggingConfig {
	/** Default log level. Defaults to "error" */
	level?: LogLevel;
	/** Per-category log levels (overrides default) */
	categories?: Record<string, LogLevel>;
}

export interface ShovelConfig {
	// Platform
	platform?: string;

	// Server
	port?: number | string;
	host?: string;
	workers?: number | string;

	// Logging
	logging?: LoggingConfig;

	// Caches (per-name with patterns)
	caches?: Record<string, CacheConfig>;

	// Buckets (per-name with patterns)
	buckets?: Record<string, BucketConfig>;
}

export interface ProcessedShovelConfig {
	platform?: string;
	port: number;
	host: string;
	workers: number;
	logging: Required<LoggingConfig>;
	caches: Record<string, CacheConfig>;
	buckets: Record<string, BucketConfig>;
}

// ============================================================================
// CONFIG LOADER
// ============================================================================

/**
 * Load Shovel configuration from shovel.json or package.json
 * Priority: shovel.json > package.json "shovel" field > defaults
 * @param cwd - Current working directory (must be provided by runtime adapter)
 */
export function loadConfig(cwd: string): ProcessedShovelConfig {
	const env = getEnv();

	// Try to load configuration from shovel.json first, then package.json
	let rawConfig: ShovelConfig = {};

	// 1. Try shovel.json (preferred standalone config)
	try {
		const shovelPath = `${cwd}/shovel.json`;
		const content = readFileSync(shovelPath, "utf-8");
		rawConfig = JSON.parse(content);
	} catch (error) {
		// No shovel.json, try package.json
		try {
			const pkgPath = `${cwd}/package.json`;
			const content = readFileSync(pkgPath, "utf-8");
			const pkgJSON = JSON.parse(content);
			rawConfig = pkgJSON.shovel || {};
		} catch (error) {
			// No package.json or no shovel field - use defaults
		}
	}

	// Process config with expression parser (strict by default)
	const processed = processConfigValue(rawConfig, env, {
		strict: true,
	}) as ShovelConfig;

	// Apply smart defaults
	const config: ProcessedShovelConfig = {
		platform: processed.platform,
		port: typeof processed.port === "number" ? processed.port : 3000,
		host: processed.host || "localhost",
		workers: typeof processed.workers === "number" ? processed.workers : 1,
		logging: {
			level: processed.logging?.level || "error",
			categories: processed.logging?.categories || {},
		},
		caches: processed.caches || {},
		buckets: processed.buckets || {},
	};

	return config;
}

// ============================================================================
// LOGGING CONFIGURATION
// ============================================================================

/** All Shovel package categories for logging */
const SHOVEL_CATEGORIES = [
	"cli",
	"watcher",
	"worker",
	"single-threaded",
	"assets",
	"platform-node",
	"platform-bun",
	"platform-cloudflare",
	"cache",
	"cache-redis",
	"router",
] as const;

/**
 * Configure LogTape logging based on Shovel config.
 * Call this in both main thread and workers.
 *
 * @param loggingConfig - The logging configuration from ProcessedShovelConfig.logging
 * @param options - Additional options
 * @param options.reset - Whether to reset existing LogTape config (default: true)
 */
export async function configureLogging(
	loggingConfig: Required<LoggingConfig>,
	options: {reset?: boolean} = {},
): Promise<void> {
	const {level, categories} = loggingConfig;
	const reset = options.reset !== false;

	// Build logger configs for each Shovel category
	const loggers = SHOVEL_CATEGORIES.map((category) => {
		// Use category-specific level if configured, otherwise use default
		const categoryLevel = categories[category] || level;
		return {
			category: [category],
			level: categoryLevel as LogTapeLevel,
			sinks: ["console"] as const,
		};
	});

	// Add meta logger config (suppress info messages about LogTape itself)
	loggers.push({
		category: ["logtape", "meta"],
		level: "warning" as LogTapeLevel,
		sinks: [] as unknown as readonly ["console"],
	});

	await configure({
		reset,
		sinks: {
			console: getConsoleSink(),
		},
		loggers,
	});
}

/**
 * Get cache config for a specific cache name (with pattern matching)
 */
export function getCacheConfig(
	config: ProcessedShovelConfig,
	name: string,
): CacheConfig {
	return matchPattern(name, config.caches) || {};
}

/**
 * Get bucket config for a specific bucket name (with pattern matching)
 */
export function getBucketConfig(
	config: ProcessedShovelConfig,
	name: string,
): BucketConfig {
	return matchPattern(name, config.buckets) || {};
}

// ============================================================================
// FACTORY HELPERS
// ============================================================================

// Well-known bucket path conventions
const WELL_KNOWN_BUCKET_PATHS: Record<string, (baseDir: string) => string> = {
	static: (baseDir) => resolve(baseDir, "../static"),
	server: (baseDir) => baseDir,
};

/**
 * Built-in bucket provider aliases
 * Maps short names to their module paths
 */
const BUILTIN_BUCKET_PROVIDERS: Record<string, string> = {
	node: "@b9g/filesystem/node.js",
	memory: "@b9g/filesystem/memory.js",
	s3: "@b9g/filesystem-s3",
};

export interface BucketFactoryOptions {
	/** Base directory for path resolution (entrypoint directory) - REQUIRED */
	baseDir: string;
	/** Shovel configuration for overrides */
	config?: ProcessedShovelConfig;
}

/**
 * Creates a bucket factory function for CustomBucketStorage.
 * Lazily imports bucket implementations.
 *
 * Provider resolution:
 * 1. "node" -> built-in NodeBucket (default)
 * 2. "memory" -> built-in MemoryBucket
 * 3. "s3" -> @b9g/filesystem-s3 (blessed module)
 * 4. Any other string -> treated as a module name (e.g., "my-custom-bucket")
 *
 * Custom bucket modules must export a class that:
 * - Implements FileSystemDirectoryHandle
 * - Has constructor(name: string, options?: object)
 */
export function createBucketFactory(options: BucketFactoryOptions) {
	const {baseDir, config} = options;

	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const bucketConfig = config ? getBucketConfig(config, name) : {};

		// Determine bucket path: config override > well-known > default convention
		let bucketPath: string;
		if (bucketConfig.path) {
			bucketPath = String(bucketConfig.path);
		} else if (WELL_KNOWN_BUCKET_PATHS[name]) {
			bucketPath = WELL_KNOWN_BUCKET_PATHS[name](baseDir);
		} else {
			bucketPath = resolve(baseDir, `../${name}`);
		}

		const provider = String(bucketConfig.provider || "node");

		// Resolve provider to module path
		const modulePath = BUILTIN_BUCKET_PROVIDERS[provider] || provider;

		// Special handling for built-in node bucket (most common case)
		if (modulePath === "@b9g/filesystem/node.js") {
			const {NodeBucket} = await import("@b9g/filesystem/node.js");
			return new NodeBucket(bucketPath);
		}

		// Special handling for built-in memory bucket
		if (modulePath === "@b9g/filesystem/memory.js") {
			const {MemoryBucket} = await import("@b9g/filesystem/memory.js");
			return new MemoryBucket(name);
		}

		// Dynamic import for all other providers (s3, custom modules)
		try {
			const module = await import(modulePath);

			// Find the bucket class - check common export patterns
			const BucketClass =
				module.default || // Default export
				module.S3Bucket || // Named export for s3
				module.Bucket || // Generic Bucket export
				Object.values(module).find(
					(v: any) => typeof v === "function" && v.name?.includes("Bucket"),
				);

			if (!BucketClass) {
				throw new Error(
					`Bucket module "${modulePath}" does not export a valid bucket class. ` +
						`Expected a default export or named export (S3Bucket, Bucket).`,
				);
			}

			// Extract options to pass to the bucket constructor
			// Remove 'provider' and 'path' as they're not bucket options
			const {provider: _, path: __, ...bucketOptions} = bucketConfig;

			// Pass name and path along with other options
			return new BucketClass(name, {path: bucketPath, ...bucketOptions});
		} catch (error: any) {
			if (
				error.code === "ERR_MODULE_NOT_FOUND" ||
				error.code === "MODULE_NOT_FOUND"
			) {
				throw new Error(
					`Bucket provider "${provider}" not found. ` +
						`Make sure the module "${modulePath}" is installed.\n` +
						`For S3: npm install @b9g/filesystem-s3`,
				);
			}
			throw error;
		}
	};
}

export interface CacheFactoryOptions {
	/** Shovel configuration for cache settings */
	config?: ProcessedShovelConfig;
}

/**
 * Built-in cache provider aliases
 * Maps short names to their module paths
 */
const BUILTIN_CACHE_PROVIDERS: Record<string, string> = {
	memory: "@b9g/cache/memory.js",
	redis: "@b9g/cache-redis",
};

/**
 * Creates a cache factory function for CustomCacheStorage.
 * Lazily imports cache implementations.
 *
 * Provider resolution:
 * 1. "memory" -> built-in MemoryCache
 * 2. "redis" -> @b9g/cache-redis (blessed module)
 * 3. Any other string -> treated as a module name (e.g., "my-custom-cache")
 *
 * Custom cache modules must export a class that:
 * - Extends Cache (from @b9g/cache)
 * - Has constructor(name: string, options?: object)
 */
export function createCacheFactory(options: CacheFactoryOptions = {}) {
	const {config} = options;

	return async (name: string): Promise<Cache> => {
		const cacheConfig = config ? getCacheConfig(config, name) : {};

		const provider = String(cacheConfig.provider || "memory");

		// Resolve provider to module path
		const modulePath = BUILTIN_CACHE_PROVIDERS[provider] || provider;

		// Special handling for built-in memory cache (most common case)
		if (modulePath === "@b9g/cache/memory.js") {
			const {MemoryCache} = await import("@b9g/cache/memory.js");
			return new MemoryCache(name, {
				maxEntries:
					typeof cacheConfig.maxEntries === "number"
						? cacheConfig.maxEntries
						: 1000,
			});
		}

		// Dynamic import for all other providers (redis, custom modules)
		try {
			const module = await import(modulePath);

			// Find the cache class - check common export patterns
			const CacheClass =
				module.default || // Default export
				module.RedisCache || // Named export for redis
				module.Cache || // Generic Cache export
				Object.values(module).find(
					(v: any) => typeof v === "function" && v.prototype instanceof Cache,
				);

			if (!CacheClass) {
				throw new Error(
					`Cache module "${modulePath}" does not export a valid cache class. ` +
						`Expected a default export or named export (RedisCache, Cache) that extends Cache.`,
				);
			}

			// Extract options to pass to the cache constructor
			// Remove 'provider' as it's not a cache option
			const {provider: _, ...cacheOptions} = cacheConfig;

			return new CacheClass(name, cacheOptions);
		} catch (error: any) {
			if (
				error.code === "ERR_MODULE_NOT_FOUND" ||
				error.code === "MODULE_NOT_FOUND"
			) {
				throw new Error(
					`Cache provider "${provider}" not found. ` +
						`Make sure the module "${modulePath}" is installed.\n` +
						`For redis: npm install @b9g/cache-redis`,
				);
			}
			throw error;
		}
	};
}
