/**
 * Configuration expression parser
 *
 * Embeddable JavaScript-like expressions for JSON config:
 * - ALL_CAPS = env var reference (e.g., NODE_ENV, PORT)
 * - Everything else = string literal (kebab-case, URLs, camelCase, PascalCase)
 * - Quoted strings = explicit strings (escape hatch)
 * - JavaScript keywords: true, false, null, undefined
 * - Operators: ||, ??, &&, ===, !==, ==, !=, ? :, !
 * - No eval - uses recursive descent parser
 *
 * Examples:
 *   "PORT || 3000"           - fallback if falsy
 *   "PORT ?? 3000"           - fallback only if null/undefined (keeps empty string)
 *   "NODE_ENV === production ? redis : memory"
 *   "REDIS_URL || redis://localhost:6379"
 *   "S3_BUCKET || my-bucket-name"
 *   "BASE_PATH || ./uploads"
 */

import {readFileSync} from "fs";

/**
 * Default configuration constants
 * Used as CLI option defaults and internal constants
 */
export const DEFAULTS = {
	SERVER: {
		PORT: 3000,
		HOST: "localhost",
	},
	WORKERS: 1, // Single worker for development - user can override with --workers flag
} as const;

/**
 * Regex to detect if a string looks like a config expression
 * Matches: operators (||, ??, &&, ===, !==, ==, !=, ?, :, !) or ALL_CAPS env vars
 */
const EXPRESSION_PATTERN =
	/(\|\||\?\?|&&|===|!==|==|!=|[?:!]|^[A-Z][A-Z0-9_]*$)/;

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
	NULLISH = "??",
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

		// Question mark operators: ?? (nullish) or ? (ternary)
		if (ch === "?") {
			if (this.#input[this.#pos + 1] === "?") {
				this.#pos += 2;
				return {type: TokenType.NULLISH, value: "??", start, end: this.#pos};
			}
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

	// LogicalOr := LogicalAnd (('||' | '??') LogicalAnd)*
	// ?? and || have same precedence, evaluated left-to-right
	#parseLogicalOr(): any {
		let left = this.#parseLogicalAnd();

		while (
			this.#peek().type === TokenType.OR ||
			this.#peek().type === TokenType.NULLISH
		) {
			const isNullish = this.#peek().type === TokenType.NULLISH;
			this.#advance(); // consume || or ??
			const right = this.#parseLogicalAnd();
			left = isNullish ? (left ?? right) : left || right;
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

				// Return undefined for missing env vars - strict check happens after
				// full expression evaluation (so || and ?? can provide fallbacks)

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
		const result = parser.parse();

		// Strict mode: throw if final result is nullish (undefined or null)
		// This allows || and ?? to provide fallbacks for undefined env vars
		if (strict && (result === undefined || result === null)) {
			throw new Error(
				`Expression evaluated to ${result}\n` +
					`The expression "${expr}" resulted in a nullish value.\n` +
					`Fix:\n` +
					`  1. Set the missing env var(s)\n` +
					`  2. Add a fallback: VAR || defaultValue\n` +
					`  3. Add a nullish fallback: VAR ?? defaultValue`,
			);
		}

		return result;
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
		if (EXPRESSION_PATTERN.test(value)) {
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
 * Built-in directory provider aliases
 * Maps short names to their module paths
 */
export const BUILTIN_DIRECTORY_PROVIDERS: Record<string, string> = {
	"node-fs": "@b9g/filesystem/node-fs.js",
	memory: "@b9g/filesystem/memory.js",
	s3: "@b9g/filesystem-s3",
};

/**
 * Built-in logging sink provider aliases
 * Maps short names to their module paths and factory function names
 */
export const BUILTIN_SINK_PROVIDERS: Record<
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

		while (
			this.#peek().type === TokenType.OR ||
			this.#peek().type === TokenType.NULLISH
		) {
			const op = this.#peek().type === TokenType.NULLISH ? "??" : "||";
			this.#advance();
			const right = this.#generateLogicalAnd();
			left = `(${left} ${op} ${right})`;
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
	if (EXPRESSION_PATTERN.test(expr)) {
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
 * Placeholder prefix for generated code references.
 * Using a unique prefix to avoid collisions with user data.
 */
const PLACEHOLDER_PREFIX = "__SHOVEL_";

/**
 * Check if a key needs quoting in a JavaScript object literal.
 * Valid unquoted keys: identifiers (a-z, A-Z, 0-9, _, $) not starting with digit.
 */
function needsQuoting(key: string): boolean {
	// Valid JS identifier: starts with letter/$/_, contains only letters/digits/$/_
	return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key);
}

/**
 * Convert a value to JavaScript object literal code.
 * Uses placeholders map to substitute JS expressions.
 * String config values are processed through exprToCode to handle env var expressions.
 */
function toJSLiteral(
	value: unknown,
	placeholders: Map<string, string>,
	indent: string = "",
): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";

	if (typeof value === "string") {
		// Check if it's a placeholder
		if (value.startsWith(PLACEHOLDER_PREFIX) && placeholders.has(value)) {
			return placeholders.get(value)!;
		}
		// Process as config expression (handles env vars like "PORT || 3000")
		return exprToCode(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const items = value.map((v) => toJSLiteral(v, placeholders, indent + "  "));
		return `[\n${indent}  ${items.join(`,\n${indent}  `)}\n${indent}]`;
	}

	if (typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) return "{}";

		const props = entries.map(([k, v]) => {
			const keyStr = needsQuoting(k) ? JSON.stringify(k) : k;
			const valStr = toJSLiteral(v, placeholders, indent + "  ");
			return `${keyStr}: ${valStr}`;
		});

		return `{\n${indent}  ${props.join(`,\n${indent}  `)}\n${indent}}`;
	}

	return JSON.stringify(value);
}

/**
 * Generate the shovel:config virtual module content.
 * This is called at build time to create the config module that gets
 * bundled into the final output.
 *
 * Uses a placeholder-based approach:
 * 1. Build config object with placeholder strings for imports/env expressions
 * 2. Convert to JavaScript object literal with proper formatting
 * 3. Substitute placeholders with actual JS code
 *
 * @param rawConfig - Raw config from shovel.json (NOT processed)
 * @param env - Environment variables for evaluating provider expressions
 */
export function generateConfigModule(
	rawConfig: ShovelConfig,
	env: Record<string, string | undefined> = getEnv(),
): string {
	// Track imports and their placeholder mappings
	const imports: string[] = [];
	const placeholders: Map<string, string> = new Map(); // placeholder -> JS code
	let placeholderCounter = 0;

	// Create a placeholder and track the JS code it represents
	const createPlaceholder = (jsCode: string): string => {
		const placeholder = `${PLACEHOLDER_PREFIX}${placeholderCounter++}__`;
		placeholders.set(placeholder, jsCode);
		return placeholder;
	};

	// Helper to evaluate provider expression and generate import
	const processProvider = (
		expr: string | undefined,
		type: "cache" | "directory",
		pattern: string,
	): string | null => {
		if (!expr) return null;

		// Evaluate provider expression at BUILD time
		const provider = parseConfigExpr(expr, env, {strict: false});
		if (!provider || provider === "memory") {
			return null; // memory is built-in, no import needed
		}

		// Map blessed names to module paths
		const builtinMap =
			type === "cache" ? BUILTIN_CACHE_PROVIDERS : BUILTIN_DIRECTORY_PROVIDERS;
		const modulePath = builtinMap[provider] || provider;

		// Generate unique variable name and import
		const varName = `${type}_${sanitizeVarName(pattern)}`;
		imports.push(`import * as ${varName} from ${JSON.stringify(modulePath)};`);

		return createPlaceholder(varName);
	};

	// Helper to process a sink provider and generate import
	// Track sink factory imports: key = "sinkName:module:factory", value = placeholder
	const sinkFactoryCache: Map<string, string> = new Map();

	const processSinkProvider = (
		providerName: string,
		sinkName: string,
	): string => {
		const builtin = BUILTIN_SINK_PROVIDERS[providerName];
		const modulePath = builtin?.module || providerName;
		const factoryName = builtin?.factory || "default";
		const cacheKey = `${sinkName}:${modulePath}:${factoryName}`;

		// Return existing placeholder if we already imported this
		if (sinkFactoryCache.has(cacheKey)) {
			return sinkFactoryCache.get(cacheKey)!;
		}

		// Generate variable name from sink name
		const varName = `sink_${sanitizeVarName(sinkName)}`;

		// Generate import
		if (factoryName === "default") {
			imports.push(`import ${varName} from ${JSON.stringify(modulePath)};`);
		} else {
			imports.push(
				`import { ${factoryName} as ${varName} } from ${JSON.stringify(modulePath)};`,
			);
		}

		const placeholder = createPlaceholder(varName);
		sinkFactoryCache.set(cacheKey, placeholder);
		return placeholder;
	};

	// Process a sink config, adding factory placeholder
	// Note: factory is a string placeholder during code generation, becomes a function at runtime
	const processSink = (
		sink: SinkConfig,
		sinkName: string,
	): Record<string, unknown> => {
		const factoryPlaceholder = processSinkProvider(
			String(sink.provider),
			sinkName,
		);
		return {...sink, factory: factoryPlaceholder};
	};

	// Build the config object with placeholders
	const buildConfig = (): Record<string, unknown> => {
		const config: Record<string, unknown> = {};

		// Platform (if specified)
		if (rawConfig.platform !== undefined) {
			config.platform = rawConfig.platform;
		}

		// Port - use process.env (shimmed from import.meta.env by esbuild define)
		if (rawConfig.port !== undefined) {
			config.port = rawConfig.port;
		} else {
			config.port = createPlaceholder(
				"process.env.PORT ? parseInt(process.env.PORT, 10) : 3000",
			);
		}

		// Host
		if (rawConfig.host !== undefined) {
			config.host = rawConfig.host;
		} else {
			config.host = createPlaceholder('process.env.HOST || "localhost"');
		}

		// Workers
		if (rawConfig.workers !== undefined) {
			config.workers = rawConfig.workers;
		} else {
			config.workers = createPlaceholder(
				"process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : 1",
			);
		}

		// Logging - LogTape-aligned structure
		const logging: Record<string, unknown> = {};

		// Named sinks (console is implicit, always available)
		const sinks: Record<string, unknown> = {};
		if (rawConfig.logging?.sinks) {
			for (const [name, sinkConfig] of Object.entries(
				rawConfig.logging.sinks,
			)) {
				sinks[name] = processSink(sinkConfig, name);
			}
		}
		logging.sinks = sinks;

		// Loggers array
		const loggers: unknown[] = [];
		if (rawConfig.logging?.loggers) {
			for (const loggerConfig of rawConfig.logging.loggers) {
				const logger: Record<string, unknown> = {
					category: loggerConfig.category,
				};
				if (loggerConfig.level) {
					logger.level = loggerConfig.level;
				}
				if (loggerConfig.sinks) {
					logger.sinks = loggerConfig.sinks;
				}
				if (loggerConfig.parentSinks) {
					logger.parentSinks = loggerConfig.parentSinks;
				}
				loggers.push(logger);
			}
		}
		logging.loggers = loggers;

		config.logging = logging;

		// Caches
		if (rawConfig.caches && Object.keys(rawConfig.caches).length > 0) {
			const caches: Record<string, unknown> = {};
			for (const [pattern, cfg] of Object.entries(rawConfig.caches)) {
				const cacheConfig: Record<string, unknown> = {...cfg};
				const providerPlaceholder = processProvider(
					String(cfg.provider),
					"cache",
					pattern,
				);
				if (providerPlaceholder) {
					cacheConfig.provider = providerPlaceholder;
				}
				caches[pattern] = cacheConfig;
			}
			config.caches = caches;
		}

		// Directories
		if (
			rawConfig.directories &&
			Object.keys(rawConfig.directories).length > 0
		) {
			const directories: Record<string, unknown> = {};
			for (const [pattern, cfg] of Object.entries(rawConfig.directories)) {
				const dirConfig: Record<string, unknown> = {...cfg};
				const providerPlaceholder = processProvider(
					String(cfg.provider),
					"directory",
					pattern,
				);
				if (providerPlaceholder) {
					dirConfig.provider = providerPlaceholder;
				}
				directories[pattern] = dirConfig;
			}
			config.directories = directories;
		}

		return config;
	};

	// Build the config object
	const config = buildConfig();

	// Convert to JavaScript object literal (not JSON - unquoted keys where valid)
	const configCode = toJSLiteral(config, placeholders, "");

	// Generate the module
	const lines: string[] = [];

	if (imports.length > 0) {
		lines.push("// Provider imports (statically bundled)");
		lines.push(...imports);
		lines.push("");
	}

	lines.push("// Generated config (env vars resolved at runtime)");
	lines.push(`export const config = ${configCode};`);

	return lines.join("\n");
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
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
	}

	// Try package.json
	try {
		const pkgPath = `${cwd}/package.json`;
		const content = readFileSync(pkgPath, "utf-8");
		const pkgJSON = JSON.parse(content);
		return pkgJSON.shovel || {};
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
	}

	return {};
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

export interface DirectoryConfig {
	provider?: string | number;
	path?: string | number;
	bucket?: string | number; // For S3-backed directories
	region?: string | number;
	endpoint?: string | number;
}

/** Log level for filtering */
export type LogLevel = "debug" | "info" | "warning" | "error";

/** Sink configuration - provider maps to built-in or custom module */
export interface SinkConfig {
	provider: string;
	/** Pre-imported factory function (from build-time code generation) */
	factory?: (options: Record<string, unknown>) => unknown;
	/** Provider-specific options (path, maxSize, etc.) */
	[key: string]: unknown;
}

/** Logger configuration - matches LogTape's logger config structure */
export interface LoggerConfig {
	/** Category as string or array for hierarchy. e.g. "myapp" or ["myapp", "db"] */
	category: string | string[];
	/** Log level for this category. Inherits from parent if not specified. */
	level?: LogLevel;
	/** Sink names to add. Inherits from parent by default. */
	sinks?: string[];
	/** Set to "override" to replace parent sinks instead of inheriting */
	parentSinks?: "override";
}

export interface LoggingConfig {
	/** Named sinks. "console" is always available implicitly. */
	sinks?: Record<string, SinkConfig>;
	/** Logger configurations. Shovel provides defaults for ["shovel", ...] categories. */
	loggers?: LoggerConfig[];
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

	// Directories (per-name with patterns)
	directories?: Record<string, DirectoryConfig>;
}

/** Processed logging config with all defaults applied */
export interface ProcessedLoggingConfig {
	sinks: Record<string, SinkConfig>;
	loggers: LoggerConfig[];
}

export interface ProcessedShovelConfig {
	platform?: string;
	port: number;
	host: string;
	workers: number;
	logging: ProcessedLoggingConfig;
	caches: Record<string, CacheConfig>;
	directories: Record<string, DirectoryConfig>;
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
	} catch (error: any) {
		// Only fall back if file doesn't exist
		if (error?.code !== "ENOENT") {
			throw error;
		}
		// No shovel.json, try package.json
		try {
			const pkgPath = `${cwd}/package.json`;
			const content = readFileSync(pkgPath, "utf-8");
			const pkgJSON = JSON.parse(content);
			rawConfig = pkgJSON.shovel || {};
		} catch (error: any) {
			// Only use defaults if file doesn't exist
			if (error?.code !== "ENOENT") {
				throw error;
			}
		}
	}

	// Process config with expression parser (strict by default)
	const processed = processConfigValue(rawConfig, env, {
		strict: true,
	}) as ShovelConfig;

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
			sinks: processed.logging?.sinks || {},
			loggers: processed.logging?.loggers || [],
		},
		caches: processed.caches || {},
		directories: processed.directories || {},
	};

	return config;
}
