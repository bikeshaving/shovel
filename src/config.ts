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
import {configure, type LogLevel as LogTapeLevel} from "@logtape/logtape";

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
		let token: Token;
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
// BUILTIN PROVIDER MAPPINGS
// ============================================================================

/**
 * Built-in cache provider aliases
 * Maps short names to their module paths
 */
export const BUILTIN_CACHE_PROVIDERS: Record<string, string> = {
	memory: "@b9g/cache/memory.js",
	redis: "@b9g/cache-redis",
};

/**
 * Built-in bucket provider aliases
 * Maps short names to their module paths
 */
export const BUILTIN_BUCKET_PROVIDERS: Record<string, string> = {
	node: "@b9g/filesystem/node.js",
	memory: "@b9g/filesystem/memory.js",
	s3: "@b9g/filesystem-s3",
};

// ============================================================================
// CODE GENERATION (for build-time config module)
// ============================================================================

/**
 * Code generator that outputs JS code instead of evaluating expressions.
 * Used for generating the shovel:config virtual module at build time.
 *
 * Instead of evaluating "PORT || 3000" to a value, it outputs:
 *   process.env.PORT || 3000
 *
 * This keeps secrets as process.env references (evaluated at runtime).
 */
class CodeGenerator {
	#tokens: Token[];
	#pos: number;

	constructor(input: string) {
		const tokenizer = new Tokenizer(input);
		this.#tokens = [];
		let token: Token;
		do {
			token = tokenizer.next();
			this.#tokens.push(token);
		} while (token.type !== TokenType.EOF);
		this.#pos = 0;
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

	generate(): string {
		const result = this.#generateExpr();
		this.#expect(TokenType.EOF);
		return result;
	}

	#generateExpr(): string {
		return this.#generateTernary();
	}

	#generateTernary(): string {
		let left = this.#generateLogicalOr();

		if (this.#peek().type === TokenType.QUESTION) {
			this.#advance();
			const trueBranch = this.#generateExpr();
			this.#expect(TokenType.COLON);
			const falseBranch = this.#generateExpr();
			return `(${left} ? ${trueBranch} : ${falseBranch})`;
		}

		return left;
	}

	#generateLogicalOr(): string {
		let left = this.#generateLogicalAnd();

		while (this.#peek().type === TokenType.OR) {
			this.#advance();
			const right = this.#generateLogicalAnd();
			left = `(${left} || ${right})`;
		}

		return left;
	}

	#generateLogicalAnd(): string {
		let left = this.#generateEquality();

		while (this.#peek().type === TokenType.AND) {
			this.#advance();
			const right = this.#generateEquality();
			left = `(${left} && ${right})`;
		}

		return left;
	}

	#generateEquality(): string {
		let left = this.#generateUnary();

		while (true) {
			const token = this.#peek();

			if (token.type === TokenType.EQ_STRICT) {
				this.#advance();
				const right = this.#generateUnary();
				left = `(${left} === ${right})`;
			} else if (token.type === TokenType.NE_STRICT) {
				this.#advance();
				const right = this.#generateUnary();
				left = `(${left} !== ${right})`;
			} else if (token.type === TokenType.EQ) {
				this.#advance();
				const right = this.#generateUnary();
				left = `(${left} == ${right})`;
			} else if (token.type === TokenType.NE) {
				this.#advance();
				const right = this.#generateUnary();
				left = `(${left} != ${right})`;
			} else {
				break;
			}
		}

		return left;
	}

	#generateUnary(): string {
		if (this.#peek().type === TokenType.NOT) {
			this.#advance();
			return `!${this.#generateUnary()}`;
		}

		return this.#generatePrimary();
	}

	#generatePrimary(): string {
		const token = this.#peek();

		if (token.type === TokenType.LPAREN) {
			this.#advance();
			const value = this.#generateExpr();
			this.#expect(TokenType.RPAREN);
			return `(${value})`;
		}

		if (token.type === TokenType.STRING) {
			this.#advance();
			return JSON.stringify(token.value);
		}
		if (token.type === TokenType.NUMBER) {
			this.#advance();
			return String(token.value);
		}
		if (token.type === TokenType.TRUE) {
			this.#advance();
			return "true";
		}
		if (token.type === TokenType.FALSE) {
			this.#advance();
			return "false";
		}
		if (token.type === TokenType.NULL) {
			this.#advance();
			return "null";
		}
		if (token.type === TokenType.UNDEFINED) {
			this.#advance();
			return "undefined";
		}

		if (token.type === TokenType.IDENTIFIER) {
			this.#advance();
			const name = token.value;

			// ALL_CAPS = env var reference → process.env.X
			if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
				return `process.env.${name}`;
			}

			// Otherwise it's a string literal
			return JSON.stringify(name);
		}

		throw new Error(
			`Unexpected token ${token.type} at position ${token.start}`,
		);
	}
}

/**
 * Convert a config expression to JS code.
 * Env vars become process.env.X, literals become quoted strings.
 *
 * Examples:
 *   "PORT || 3000" → 'process.env.PORT || 3000'
 *   "REDIS_URL" → 'process.env.REDIS_URL'
 *   "redis" → '"redis"'
 *   "NODE_ENV === production ? redis : memory" → '(process.env.NODE_ENV === "production" ? "redis" : "memory")'
 */
export function exprToCode(expr: string): string {
	// Check if it looks like an expression (contains operators or env vars)
	if (/(\|\||&&|===|!==|==|!=|[?:!]|^[A-Z][A-Z0-9_]*$)/.test(expr)) {
		try {
			const generator = new CodeGenerator(expr);
			return generator.generate();
		} catch (error) {
			throw new Error(
				`Invalid config expression: ${expr}\n` +
					`Error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	// Plain string literal
	return JSON.stringify(expr);
}

/**
 * Convert any config value to JS code representation.
 * Recursively handles objects and arrays.
 */
export function valueToCode(value: unknown): string {
	if (typeof value === "string") {
		return exprToCode(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return JSON.stringify(value);
	}

	if (value === null) {
		return "null";
	}

	if (value === undefined) {
		return "undefined";
	}

	if (Array.isArray(value)) {
		const items = value.map((item) => valueToCode(item));
		return `[${items.join(", ")}]`;
	}

	if (typeof value === "object") {
		const entries = Object.entries(value).map(
			([key, val]) => `${JSON.stringify(key)}: ${valueToCode(val)}`,
		);
		return `{${entries.join(", ")}}`;
	}

	return JSON.stringify(value);
}

/**
 * Sanitize a pattern name for use as a JavaScript variable name.
 */
function sanitizeVarName(pattern: string): string {
	return pattern
		.replace(/\*/g, "default")
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/^(\d)/, "_$1");
}

/**
 * Generate the shovel:config virtual module content.
 * This is called at build time to create the config module that gets
 * bundled into the final output.
 *
 * @param rawConfig - Raw config from shovel.json (NOT processed)
 * @param env - Environment variables for evaluating provider expressions
 */
export function generateConfigModule(
	rawConfig: ShovelConfig,
	env: Record<string, string | undefined> = getEnv(),
): string {
	const imports: string[] = [];
	const providerRefs: Record<string, string> = {};

	// Helper to evaluate provider expression and generate import
	const processProvider = (
		expr: string | undefined,
		type: "cache" | "bucket",
		pattern: string,
	): string | null => {
		if (!expr) return null;

		// Evaluate provider expression at BUILD time
		const provider = parseConfigExpr(expr, env, {strict: false});
		if (!provider || provider === "memory") {
			// memory is built-in, no import needed
			return null;
		}

		// Map blessed names to module paths
		const builtinMap =
			type === "cache" ? BUILTIN_CACHE_PROVIDERS : BUILTIN_BUCKET_PROVIDERS;
		const modulePath = builtinMap[provider] || provider;

		// Generate unique variable name
		const varName = `${type}_${sanitizeVarName(pattern)}`;
		imports.push(`import * as ${varName} from ${JSON.stringify(modulePath)};`);
		providerRefs[`${type}.${pattern}`] = varName;

		return varName;
	};

	// Process cache providers
	for (const [pattern, cfg] of Object.entries(rawConfig.caches || {})) {
		if (cfg.provider) {
			processProvider(String(cfg.provider), "cache", pattern);
		}
	}

	// Process bucket providers
	for (const [pattern, cfg] of Object.entries(rawConfig.buckets || {})) {
		if (cfg.provider) {
			processProvider(String(cfg.provider), "bucket", pattern);
		}
	}

	// Generate config object code
	const generateConfigCode = (): string => {
		const lines: string[] = [];
		lines.push("{");

		// Platform (if specified)
		if (rawConfig.platform !== undefined) {
			lines.push(`  platform: ${valueToCode(rawConfig.platform)},`);
		}

		// Port
		if (rawConfig.port !== undefined) {
			lines.push(`  port: ${valueToCode(rawConfig.port)},`);
		} else {
			lines.push(
				`  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,`,
			);
		}

		// Host
		if (rawConfig.host !== undefined) {
			lines.push(`  host: ${valueToCode(rawConfig.host)},`);
		} else {
			lines.push(`  host: process.env.HOST || "localhost",`);
		}

		// Workers
		if (rawConfig.workers !== undefined) {
			lines.push(`  workers: ${valueToCode(rawConfig.workers)},`);
		} else {
			lines.push(
				`  workers: process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : 1,`,
			);
		}

		// Logging
		if (rawConfig.logging) {
			lines.push(`  logging: ${valueToCode(rawConfig.logging)},`);
		}

		// Caches - with provider references
		if (rawConfig.caches && Object.keys(rawConfig.caches).length > 0) {
			lines.push("  caches: {");
			for (const [pattern, cfg] of Object.entries(rawConfig.caches)) {
				const providerVar = providerRefs[`cache.${pattern}`];
				lines.push(`    ${JSON.stringify(pattern)}: {`);
				for (const [key, val] of Object.entries(cfg)) {
					if (key === "provider" && providerVar) {
						// Use the imported provider module reference
						lines.push(`      provider: ${providerVar},`);
					} else {
						lines.push(`      ${key}: ${valueToCode(val)},`);
					}
				}
				lines.push("    },");
			}
			lines.push("  },");
		}

		// Buckets - with provider references
		if (rawConfig.buckets && Object.keys(rawConfig.buckets).length > 0) {
			lines.push("  buckets: {");
			for (const [pattern, cfg] of Object.entries(rawConfig.buckets)) {
				const providerVar = providerRefs[`bucket.${pattern}`];
				lines.push(`    ${JSON.stringify(pattern)}: {`);
				for (const [key, val] of Object.entries(cfg)) {
					if (key === "provider" && providerVar) {
						lines.push(`      provider: ${providerVar},`);
					} else {
						lines.push(`      ${key}: ${valueToCode(val)},`);
					}
				}
				lines.push("    },");
			}
			lines.push("  },");
		}

		lines.push("}");
		return lines.join("\n");
	};

	// Generate the module
	const moduleLines: string[] = [];

	// Add imports
	if (imports.length > 0) {
		moduleLines.push("// Provider imports (statically bundled)");
		moduleLines.push(...imports);
		moduleLines.push("");
	}

	// Add config export
	moduleLines.push(
		"// Generated config (secrets stay as process.env references)",
	);
	moduleLines.push(`export const config = ${generateConfigCode()};`);

	return moduleLines.join("\n");
}

/**
 * Load raw config from shovel.json without processing expressions.
 * Used at build time to get the config before code generation.
 */
export function loadRawConfig(cwd: string): ShovelConfig {
	// Try shovel.json first
	try {
		const shovelPath = `${cwd}/shovel.json`;
		const content = readFileSync(shovelPath, "utf-8");
		return JSON.parse(content);
	} catch {
		// Try package.json
		try {
			const pkgPath = `${cwd}/package.json`;
			const content = readFileSync(pkgPath, "utf-8");
			const pkgJSON = JSON.parse(content);
			return pkgJSON.shovel || {};
		} catch {
			return {};
		}
	}
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

/** Sink configuration */
export interface SinkConfig {
	provider: string;
	/** Provider-specific options (path, maxSize, etc.) */
	[key: string]: any;
}

/** Per-category logging configuration */
export interface CategoryLoggingConfig {
	level?: LogLevel;
	sinks?: SinkConfig[];
}

export interface LoggingConfig {
	/** Default log level. Defaults to "info" */
	level?: LogLevel;
	/** Default sinks. Defaults to console */
	sinks?: SinkConfig[];
	/** Per-category config (inherits from top-level, can override level and/or sinks) */
	categories?: Record<string, CategoryLoggingConfig>;
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

/** Processed logging config with all defaults applied */
export interface ProcessedLoggingConfig {
	level: LogLevel;
	sinks: SinkConfig[];
	categories: Record<string, CategoryLoggingConfig>;
}

export interface ProcessedShovelConfig {
	platform?: string;
	port: number;
	host: string;
	workers: number;
	logging: ProcessedLoggingConfig;
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

	// Default sink config
	const defaultSinks: SinkConfig[] = [{provider: "console"}];

	// Apply config precedence: json value > canonical env var > default
	// If a key exists in json, use it (already processed with expressions)
	// Otherwise, check canonical env var (uppercase key name)
	// Finally, fall back to default
	const config: ProcessedShovelConfig = {
		platform: processed.platform ?? env.PLATFORM ?? undefined,
		port:
			processed.port !== undefined
				? typeof processed.port === "number"
					? processed.port
					: parseInt(String(processed.port), 10)
				: env.PORT
					? parseInt(env.PORT, 10)
					: 3000,
		host: processed.host ?? env.HOST ?? "localhost",
		workers:
			processed.workers !== undefined
				? typeof processed.workers === "number"
					? processed.workers
					: parseInt(String(processed.workers), 10)
				: env.WORKERS
					? parseInt(env.WORKERS, 10)
					: 1,
		logging: {
			level: processed.logging?.level || "info",
			sinks: processed.logging?.sinks || defaultSinks,
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

/** Built-in sink provider aliases */
const BUILTIN_SINK_PROVIDERS: Record<
	string,
	{module: string; factory: string}
> = {
	console: {module: "@logtape/logtape", factory: "getConsoleSink"},
	file: {module: "@logtape/file", factory: "getFileSink"},
	rotating: {module: "@logtape/file", factory: "getRotatingFileSink"},
	"stream-file": {module: "@logtape/file", factory: "getStreamFileSink"},
	otel: {module: "@logtape/otel", factory: "getOpenTelemetrySink"},
	sentry: {module: "@logtape/sentry", factory: "getSentrySink"},
	syslog: {module: "@logtape/syslog", factory: "getSyslogSink"},
	cloudwatch: {
		module: "@logtape/cloudwatch-logs",
		factory: "getCloudWatchLogsSink",
	},
};

/**
 * Create a sink from config.
 * Checks the build-time registry first, falls back to dynamic import.
 * Supports built-in providers (console, file, rotating, etc.) and custom modules.
 */
async function createSink(
	config: SinkConfig,
	options: {cwd?: string} = {},
): Promise<any> {
	const {provider, ...sinkOptions} = config;

	// Resolve relative paths for file-based sinks
	if (sinkOptions.path && options.cwd) {
		sinkOptions.path = resolve(options.cwd, sinkOptions.path);
	}

	// Dynamic import based on provider name
	const builtin = BUILTIN_SINK_PROVIDERS[provider];
	const modulePath = builtin?.module || provider;
	const factoryName = builtin?.factory || "default";

	const module = await import(modulePath);
	const factory = module[factoryName] || module.default;

	if (!factory) {
		throw new Error(
			`Sink module "${modulePath}" has no export "${factoryName}"`,
		);
	}

	// Pass options to factory (path, maxSize, etc.)
	return factory(sinkOptions);
}

/**
 * Configure LogTape logging based on Shovel config.
 * Call this in both main thread and workers.
 *
 * @param loggingConfig - The logging configuration from ProcessedShovelConfig.logging
 * @param options - Additional options
 * @param options.reset - Whether to reset existing LogTape config (default: true)
 * @param options.cwd - Working directory for resolving relative paths
 */
export async function configureLogging(
	loggingConfig: ProcessedLoggingConfig,
	options: {reset?: boolean; cwd?: string} = {},
): Promise<void> {
	const {level, sinks: defaultSinkConfigs, categories} = loggingConfig;
	const reset = options.reset !== false;

	// Create all unique sinks (default + category-specific)
	const allSinkConfigs = new Map<string, SinkConfig>();
	const sinkNameMap = new Map<SinkConfig, string>();

	// Add default sinks
	for (let i = 0; i < defaultSinkConfigs.length; i++) {
		const config = defaultSinkConfigs[i];
		const name = `sink_${i}`;
		allSinkConfigs.set(name, config);
		sinkNameMap.set(config, name);
	}

	// Add category-specific sinks
	let sinkIndex = defaultSinkConfigs.length;
	for (const [_, categoryConfig] of Object.entries(categories)) {
		if (categoryConfig.sinks) {
			for (const config of categoryConfig.sinks) {
				// Check if this sink config is already added
				let found = false;
				for (const [existingConfig, _name] of sinkNameMap) {
					if (JSON.stringify(existingConfig) === JSON.stringify(config)) {
						found = true;
						break;
					}
				}
				if (!found) {
					const name = `sink_${sinkIndex++}`;
					allSinkConfigs.set(name, config);
					sinkNameMap.set(config, name);
				}
			}
		}
	}

	// Create sink instances
	const sinks: Record<string, any> = {};
	for (const [name, config] of allSinkConfigs) {
		sinks[name] = await createSink(config, {cwd: options.cwd});
	}

	// Get sink names for a given array of sink configs
	const getSinkNames = (configs: SinkConfig[]): string[] => {
		return configs
			.map((config) => {
				for (const [existingConfig, name] of sinkNameMap) {
					if (JSON.stringify(existingConfig) === JSON.stringify(config)) {
						return name;
					}
				}
				return "";
			})
			.filter(Boolean);
	};

	// Default sink names
	const defaultSinkNames = getSinkNames(defaultSinkConfigs);

	// Build logger configs for each Shovel category
	const loggers: Array<{
		category: string[];
		level: LogTapeLevel;
		sinks: string[];
	}> = SHOVEL_CATEGORIES.map((category) => {
		const categoryConfig = categories[category];
		const categoryLevel = categoryConfig?.level || level;
		const categorySinks = categoryConfig?.sinks
			? getSinkNames(categoryConfig.sinks)
			: defaultSinkNames;

		return {
			category: [category],
			level: categoryLevel as LogTapeLevel,
			sinks: categorySinks,
		};
	});

	// Add meta logger config (suppress info messages about LogTape itself)
	loggers.push({
		category: ["logtape", "meta"],
		level: "warning",
		sinks: [],
	});

	await configure({
		reset,
		sinks,
		loggers,
	});
}

