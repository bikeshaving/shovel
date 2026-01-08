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
import {tmpdir} from "os";
import {join} from "path";
import {z} from "zod";

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
 * Matches: operators (||, ??, &&, ===, !==, ==, !=), $VAR env refs, or dunders
 * Note: ? and : are not included alone because they appear in URLs (http://...)
 * Ternary expressions require at least one of the other operators
 */
const EXPRESSION_PATTERN =
	/(\|\||\?\?|&&|===|!==|==|!=|\$[A-Za-z_]|\[outdir\]|\[tmpdir\]|\[git\])/;

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

	// Expression-specific
	ENV_VAR = "ENV_VAR", // $IDENTIFIER
	OUTDIR = "OUTDIR", // [outdir]
	TMPDIR = "TMPDIR", // [tmpdir]
	GIT = "GIT", // [git]
	SLASH = "SLASH", // / (path join operator)

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

		// Quoted strings (double or single quotes)
		if (ch === '"' || ch === "'") {
			const quote = ch;
			this.#advance(); // consume opening quote
			let value = "";
			while (this.#peek() && this.#peek() !== quote) {
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
			if (this.#peek() !== quote) {
				throw new Error(`Unterminated string at position ${start}`);
			}
			this.#advance(); // consume closing quote
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

		// Environment variable: $IDENTIFIER
		if (ch === "$") {
			this.#advance(); // consume $
			let name = "";
			// Env var names: start with letter, then letters/digits/underscore
			while (/[A-Za-z0-9_]/.test(this.#peek())) {
				name += this.#advance();
			}
			if (!name) {
				throw new Error(`Expected env var name after $ at position ${start}`);
			}
			return {type: TokenType.ENV_VAR, value: name, start, end: this.#pos};
		}

		// Slash for path joining
		if (ch === "/") {
			this.#advance();
			return {type: TokenType.SLASH, value: "/", start, end: this.#pos};
		}

		// Bracket placeholders: [outdir], [tmpdir], [git]
		if (ch === "[") {
			const remaining = this.#input.slice(this.#pos);
			if (remaining.startsWith("[outdir]")) {
				this.#pos += 8;
				return {
					type: TokenType.OUTDIR,
					value: "[outdir]",
					start,
					end: this.#pos,
				};
			}
			if (remaining.startsWith("[tmpdir]")) {
				this.#pos += 8;
				return {
					type: TokenType.TMPDIR,
					value: "[tmpdir]",
					start,
					end: this.#pos,
				};
			}
			if (remaining.startsWith("[git]")) {
				this.#pos += 5;
				return {
					type: TokenType.GIT,
					value: "[git]",
					start,
					end: this.#pos,
				};
			}
			throw new Error(
				`Unknown placeholder at position ${start}: ${remaining.slice(0, 10)}`,
			);
		}

		// Colon - only tokenize as ternary operator when surrounded by whitespace
		// This allows word:word patterns (like bun:sqlite, node:fs, custom:thing) to be single identifiers
		// Ternary expressions use spaces: "cond ? a : b" not "cond?a:b"
		if (ch === ":") {
			// Check if there's whitespace before (we just skipped it, so check if start > 0 and char before start is whitespace)
			const charBefore = start > 0 ? this.#input[start - 1] : "";
			const charAfter = this.#input[this.#pos + 1] || "";
			const hasSpaceBefore = start === 0 || /\s/.test(charBefore);
			const hasSpaceAfter = !charAfter || /\s/.test(charAfter);

			if (hasSpaceBefore && hasSpaceAfter) {
				this.#advance();
				return {type: TokenType.COLON, value: ":", start, end: this.#pos};
			}
			// Otherwise fall through to identifier parsing - colon is part of an identifier
		}

		// Identifiers and literals
		// Catchall: consume everything that's not whitespace or an operator
		// This naturally handles: kebab-case, camelCase, module specifiers (bun:sqlite), URLs, etc.
		// Excludes: operators, $, single / (which have special meaning)
		if (/\S/.test(ch) && !/[?!()=|&$/]/.test(ch)) {
			let value = "";
			while (/\S/.test(this.#peek()) && !/[?!()=|&$]/.test(this.#peek())) {
				// Colon: include it in identifier if followed by non-whitespace (word:word pattern)
				// Stop only if colon is followed by whitespace (ternary context)
				if (this.#peek() === ":") {
					const next = this.#input[this.#pos + 1];
					if (!next || /\s/.test(next)) {
						break; // Ternary colon (followed by space or EOF)
					}
					// Otherwise include colon and continue (module specifier, URL pattern)
				}
				// Slash: include // (URLs) but stop at single / (path join)
				if (this.#peek() === "/") {
					if (this.#input[this.#pos + 1] === "/") {
						// Double slash - part of URL, include both
						value += this.#advance(); // first /
						value += this.#advance(); // second /
						continue;
					}
					break; // Single slash - path join operator
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

			// Identifier (string literal - bare ALL_CAPS is now literal, not env var)
			return {type: TokenType.IDENTIFIER, value, start, end: this.#pos};
		}

		throw new Error(`Unexpected character '${ch}' at position ${start}`);
	}
}

// ============================================================================
// PARSER
// ============================================================================

/**
 * Platform functions for runtime expression evaluation.
 * These are injected to allow testing and platform-specific implementations.
 */
interface PlatformFunctions {
	outdir: () => string;
	tmpdir: () => string;
	git: () => string;
	joinPath: (...segments: string[]) => string;
}

/**
 * Default platform functions using Node.js APIs
 */
const defaultPlatformFunctions: PlatformFunctions = {
	outdir: () => {
		// Default to cwd - in real usage, this is set by the build system
		// eslint-disable-next-line no-restricted-properties
		return process.cwd();
	},
	tmpdir: () => tmpdir(),
	git: () => {
		// Default to "unknown" - in real usage, this is set by the build system
		return "unknown";
	},
	joinPath: (...segments: string[]) => join(...segments),
};

class Parser {
	#tokens: Token[];
	#pos: number;
	#env: Record<string, string | undefined>;
	#strict: boolean;
	#platform: PlatformFunctions;

	constructor(
		input: string,
		env: Record<string, string | undefined>,
		strict: boolean,
		platform: PlatformFunctions = defaultPlatformFunctions,
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
		this.#platform = platform;
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

	// Primary := PathExpr | Literal | '(' Expr ')'
	// PathExpr := (EnvVar | Dunder | Identifier) PathSuffix?
	// PathSuffix := ('/' Segment)+
	#parsePrimary(): any {
		const token = this.#peek();

		// Parenthesized expression (may have path suffix)
		if (token.type === TokenType.LPAREN) {
			this.#advance(); // consume (
			const value = this.#parseExpr();
			this.#expect(TokenType.RPAREN);
			return this.#parsePathSuffix(value);
		}

		// Literals (no path suffix for these)
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

		// Environment variable: $VAR (may have path suffix)
		if (token.type === TokenType.ENV_VAR) {
			this.#advance();
			const name = token.value;
			const value = this.#env[name];

			// Auto-convert numeric strings to numbers
			let result: any = value;
			if (typeof value === "string" && /^\d+$/.test(value)) {
				result = parseInt(value, 10);
			}

			return this.#parsePathSuffix(result);
		}

		// Bracket placeholders (may have path suffix)
		if (token.type === TokenType.OUTDIR) {
			this.#advance();
			return this.#parsePathSuffix(this.#platform.outdir());
		}
		if (token.type === TokenType.TMPDIR) {
			this.#advance();
			return this.#parsePathSuffix(this.#platform.tmpdir());
		}
		if (token.type === TokenType.GIT) {
			this.#advance();
			return this.#parsePathSuffix(this.#platform.git());
		}

		// Identifier (string literal - may have path suffix for paths like ./data)
		if (token.type === TokenType.IDENTIFIER) {
			this.#advance();
			return this.#parsePathSuffix(token.value);
		}

		throw new Error(
			`Unexpected token ${token.type} at position ${token.start}`,
		);
	}

	// Parse optional path suffix: ('/' Segment)+
	// Returns the value joined with any path segments
	#parsePathSuffix(base: any): any {
		const segments: string[] = [];

		while (this.#peek().type === TokenType.SLASH) {
			this.#advance(); // consume /

			// Collect path segment (next identifier or string)
			const segToken = this.#peek();
			if (
				segToken.type === TokenType.IDENTIFIER ||
				segToken.type === TokenType.STRING
			) {
				this.#advance();
				segments.push(segToken.value);
			} else if (segToken.type === TokenType.NUMBER) {
				this.#advance();
				segments.push(String(segToken.value));
			} else {
				throw new Error(
					`Expected path segment after / at position ${segToken.start}`,
				);
			}
		}

		// No suffix - return base as-is
		if (segments.length === 0) {
			return base;
		}

		// If base is undefined, propagate it - don't silently convert to empty string
		// This ensures missing env vars with path suffixes are properly detected
		if (base === undefined) {
			return undefined;
		}

		// Join base with segments using platform joinPath
		return this.#platform.joinPath(String(base), ...segments);
	}
}

/**
 * Parse a configuration expression with the DSL
 */
export function parseConfigExpr(
	expr: string,
	env: Record<string, string | undefined> = getEnv(),
	options: {strict?: boolean; platform?: PlatformFunctions} = {},
): any {
	const strict = options.strict !== false; // default true

	try {
		const parser = new Parser(expr, env, strict, options.platform);
		const result = parser.parse();

		// Strict mode: throw if final result is nullish (undefined or null)
		// This allows || and ?? to provide fallbacks for undefined env vars
		if (strict && (result === undefined || result === null)) {
			throw new Error(
				`Expression evaluated to ${result}\n` +
					`The expression "${expr}" resulted in a nullish value.\n` +
					`Fix:\n` +
					`  1. Set the missing env var(s)\n` +
					`  2. Add a fallback: $VAR || defaultValue\n` +
					`  3. Add a nullish fallback: $VAR ?? defaultValue`,
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
// CODE GENERATION (for build-time config module)
// ============================================================================

/**
 * Code generator that outputs JS code instead of evaluating expressions.
 * Used for generating the shovel:config virtual module at build time.
 *
 * Instead of evaluating "$PORT || 3000" to a value, it outputs:
 *   env("PORT") || 3000
 *
 * This keeps secrets as runtime references (evaluated at runtime).
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

		// Parenthesized expression (may have path suffix)
		if (token.type === TokenType.LPAREN) {
			this.#advance();
			const value = this.#generateExpr();
			this.#expect(TokenType.RPAREN);
			return this.#generatePathSuffix(`(${value})`);
		}

		// Literals (no path suffix)
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

		// Environment variable: $VAR → process.env.VAR or process.env["VAR"]
		if (token.type === TokenType.ENV_VAR) {
			this.#advance();
			// Use bracket notation if name has special chars, dot notation otherwise
			const name = token.value;
			const code = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
				? `process.env.${name}`
				: `process.env[${JSON.stringify(name)}]`;
			// Mark as required env var - path suffix should not mask undefined
			return this.#generatePathSuffix(code, {requiredEnvVar: name});
		}

		// Bracket placeholders (may have path suffix)
		// [outdir] → __SHOVEL_OUTDIR__ (injected by esbuild)
		if (token.type === TokenType.OUTDIR) {
			this.#advance();
			return this.#generatePathSuffix("__SHOVEL_OUTDIR__");
		}
		// [tmpdir] → tmpdir() (provided by platform entry wrapper via "os" import)
		if (token.type === TokenType.TMPDIR) {
			this.#advance();
			return this.#generatePathSuffix("tmpdir()");
		}
		// [git] → __SHOVEL_GIT__ (injected by esbuild)
		if (token.type === TokenType.GIT) {
			this.#advance();
			return this.#generatePathSuffix("__SHOVEL_GIT__");
		}

		// Identifier (string literal - may have path suffix for paths like ./data)
		if (token.type === TokenType.IDENTIFIER) {
			this.#advance();
			return this.#generatePathSuffix(JSON.stringify(token.value));
		}

		throw new Error(
			`Unexpected token ${token.type} at position ${token.start}`,
		);
	}

	// Generate path suffix code: base/segment/... → [base, "segment", ...].join("/")
	// If requiredEnvVar is set, generate code that throws if the env var is missing
	#generatePathSuffix(
		baseCode: string,
		options: {requiredEnvVar?: string} = {},
	): string {
		const segments: string[] = [];

		while (this.#peek().type === TokenType.SLASH) {
			this.#advance(); // consume /

			const segToken = this.#peek();
			if (
				segToken.type === TokenType.IDENTIFIER ||
				segToken.type === TokenType.STRING
			) {
				this.#advance();
				segments.push(JSON.stringify(segToken.value));
			} else if (segToken.type === TokenType.NUMBER) {
				this.#advance();
				segments.push(JSON.stringify(String(segToken.value)));
			} else {
				throw new Error(
					`Expected path segment after / at position ${segToken.start}`,
				);
			}
		}

		// No suffix - return base code as-is
		if (segments.length === 0) {
			return baseCode;
		}

		// For required env vars with path suffix, don't mask undefined with filter(Boolean)
		// Instead, throw a clear error if the env var is missing
		if (options.requiredEnvVar) {
			const envName = options.requiredEnvVar;
			// Generate: (() => { const v = process.env.VAR; if (v == null) throw new Error("..."); return [v, ...].join("/"); })()
			return `(() => { const v = ${baseCode}; if (v == null) throw new Error("Required env var ${envName} is not set"); return [v, ${segments.join(", ")}].join("/"); })()`;
		}

		// For optional values (with fallback), filter(Boolean) is fine
		return `[${baseCode}, ${segments.join(", ")}].filter(Boolean).join("/")`;
	}
}

/**
 * Result of converting an expression to code
 */
export interface ExprToCodeResult {
	code: string;
}

/**
 * Convert a config expression to JS code.
 * Env vars become process.env.VAR, bracket placeholders become platform-specific code.
 *
 * Examples:
 *   "$PORT || 3000" → 'process.env.PORT || 3000'
 *   "$DATADIR/uploads" → '[process.env.DATADIR, "uploads"].filter(Boolean).join("/")'
 *   "[outdir]/data" → '[__SHOVEL_OUTDIR__, "data"].filter(Boolean).join("/")'
 *   "[tmpdir]/cache" → '[tmpdir(), "cache"].filter(Boolean).join("/")'
 *   "[git]" → '__SHOVEL_GIT__'
 *   "redis" → '"redis"'
 *
 * Note: [tmpdir] generates tmpdir() which must be provided by the platform
 * entry wrapper (via `import {tmpdir} from "os"`). Cloudflare does not support
 * [tmpdir] since it has no filesystem.
 */
export function exprToCode(expr: string): ExprToCodeResult {
	// Check if it looks like an expression (contains operators, $VAR, or dunders)
	if (EXPRESSION_PATTERN.test(expr)) {
		try {
			const generator = new CodeGenerator(expr);
			const code = generator.generate();
			return {code};
		} catch (error) {
			throw new Error(
				`Invalid config expression: ${expr}\n` +
					`Error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	// Plain string literal
	return {code: JSON.stringify(expr)};
}

/**
 * Convert any config value to JS code representation.
 * Recursively handles objects and arrays.
 */
export function valueToCode(value: unknown): ExprToCodeResult {
	if (typeof value === "string") {
		return exprToCode(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return {code: JSON.stringify(value)};
	}

	if (value === null) {
		return {code: "null"};
	}

	if (value === undefined) {
		return {code: "undefined"};
	}

	if (Array.isArray(value)) {
		const items = value.map((item) => valueToCode(item).code);
		return {code: `[${items.join(", ")}]`};
	}

	if (typeof value === "object") {
		const entries = Object.entries(value).map(([key, val]) => {
			return `${JSON.stringify(key)}: ${valueToCode(val).code}`;
		});
		return {code: `{${entries.join(", ")}}`};
	}

	return {code: JSON.stringify(value)};
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

/** Result of toJSLiteral */
interface JSLiteralResult {
	code: string;
	/** Whether this value contains dynamic expressions (process.env, etc) */
	isDynamic: boolean;
}

/**
 * Check if a code string contains dynamic expressions (process.env, tmpdir(), etc)
 * Note: __SHOVEL_OUTDIR__ and __SHOVEL_GIT__ are build-time constants, not dynamic
 */
function isDynamicCode(code: string): boolean {
	return (
		code.includes("process.env") ||
		code.includes("tmpdir()") ||
		code.includes(".filter(Boolean).join")
	);
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
): JSLiteralResult {
	if (value === null) return {code: "null", isDynamic: false};
	if (value === undefined) return {code: "undefined", isDynamic: false};

	if (typeof value === "string") {
		// Check if it's a placeholder
		if (value.startsWith(PLACEHOLDER_PREFIX) && placeholders.has(value)) {
			return {code: placeholders.get(value)!, isDynamic: false};
		}
		// Process as config expression (handles env vars like "$PORT || 3000")
		const result = exprToCode(value);
		return {code: result.code, isDynamic: isDynamicCode(result.code)};
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return {code: String(value), isDynamic: false};
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return {code: "[]", isDynamic: false};
		let anyDynamic = false;
		const items = value.map((v) => {
			const result = toJSLiteral(v, placeholders, indent + "  ");
			if (result.isDynamic) anyDynamic = true;
			return result.code;
		});
		return {
			code: `[\n${indent}  ${items.join(`,\n${indent}  `)}\n${indent}]`,
			isDynamic: anyDynamic,
		};
	}

	if (typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) return {code: "{}", isDynamic: false};

		let anyDynamic = false;
		const props = entries.map(([k, v]) => {
			const keyStr = needsQuoting(k) ? JSON.stringify(k) : k;
			const result = toJSLiteral(v, placeholders, indent + "  ");
			if (result.isDynamic) anyDynamic = true;
			// If the value is dynamic, make it a getter for lazy evaluation
			// This ensures process.env is evaluated at access time, not module load time
			if (result.isDynamic) {
				return `get ${keyStr}() { return ${result.code}; }`;
			}
			return `${keyStr}: ${result.code}`;
		});

		return {
			code: `{\n${indent}  ${props.join(`,\n${indent}  `)}\n${indent}}`,
			isDynamic: anyDynamic,
		};
	}

	return {code: JSON.stringify(value), isDynamic: false};
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
 * @param options - Options including platform defaults
 */
export function generateConfigModule(
	rawConfig: ShovelConfig,
	options: {
		/** Absolute path to project directory (where shovel.json lives) */
		projectDir: string;
		/** Absolute path to output directory */
		outDir: string;
		/** Platform-specific defaults for directories, caches, etc. */
		platformDefaults?: {
			directories?: Record<
				string,
				{module: string; export?: string; [key: string]: unknown}
			>;
			caches?: Record<
				string,
				{module: string; export?: string; [key: string]: unknown}
			>;
		};
	},
): string {
	const {platformDefaults = {}} = options;
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

	// Track which imports have been added to avoid duplicates
	// Maps import key (module:export) to the variable name used
	const addedImports = new Map<string, string>();

	// Helper to generate import and placeholder for a module/export config
	// Returns placeholder that will be replaced with the imported function/class
	const processModule = (
		modulePath: string | undefined,
		exportName: string | undefined,
		type: "cache" | "directory" | "sink" | "database",
		name: string,
	): string | null => {
		if (!modulePath) return null;

		const varName = `${type}_${sanitizeVarName(name)}`;
		const actualExport = exportName || "default";
		// Key by module+export to share imports across different names using same class
		const importKey = `${modulePath}:${actualExport}`;

		// Check if we already have this import
		const existingVarName = addedImports.get(importKey);
		if (existingVarName) {
			// Reuse the existing import's variable name
			return createPlaceholder(existingVarName);
		}

		// First time seeing this import - add it
		addedImports.set(importKey, varName);
		if (actualExport === "default") {
			imports.push(`import ${varName} from ${JSON.stringify(modulePath)};`);
		} else {
			imports.push(
				`import { ${actualExport} as ${varName} } from ${JSON.stringify(modulePath)};`,
			);
		}

		return createPlaceholder(varName);
	};

	// Helper to process a config object with module/export pattern
	// Replaces module/export with `impl` (the reified function/class)
	const reifyModule = <T extends {module?: string; export?: string}>(
		config: T,
		type: "cache" | "directory" | "sink" | "database",
		name: string,
	): Omit<T, "module" | "export"> & {impl?: string} => {
		const {module: modulePath, export: exportName, ...rest} = config;
		const implPlaceholder = processModule(modulePath, exportName, type, name);
		if (implPlaceholder) {
			return {...rest, impl: implPlaceholder} as any;
		}
		return rest as any;
	};

	// Process a sink config, replacing module/export with impl
	const processSink = (
		sink: SinkConfig,
		sinkName: string,
	): Record<string, unknown> => {
		return reifyModule(sink, "sink", sinkName);
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

		// Caches - deep merge platform defaults with user config
		// User config properties override platform defaults, but missing properties are preserved
		const platformCaches = platformDefaults.caches || {};
		const userCaches = rawConfig.caches || {};
		const allCacheNames = new Set([
			...Object.keys(platformCaches),
			...Object.keys(userCaches),
		]);
		if (allCacheNames.size > 0) {
			const caches: Record<string, unknown> = {};
			for (const name of allCacheNames) {
				// Deep merge: platform defaults first, then user overrides
				const platformConfig = platformCaches[name] || {};
				const userConfig = userCaches[name] || {};
				const mergedConfig = {...platformConfig, ...userConfig};
				caches[name] = reifyModule(mergedConfig, "cache", name);
			}
			config.caches = caches;
		}

		// Directories - deep merge platform defaults with user config
		// User config properties override platform defaults, but missing properties are preserved
		// Path values are processed using the path syntax parser
		const platformDirectories = platformDefaults.directories || {};
		const userDirectories = rawConfig.directories || {};
		const allDirectoryNames = new Set([
			...Object.keys(platformDirectories),
			...Object.keys(userDirectories),
		]);
		if (allDirectoryNames.size > 0) {
			const directories: Record<string, unknown> = {};
			for (const name of allDirectoryNames) {
				// Deep merge: platform defaults first, then user overrides
				const platformConfig = platformDirectories[name] || {};
				const userConfig = userDirectories[name] || {};
				const mergedConfig = {...platformConfig, ...userConfig};
				directories[name] = reifyModule(mergedConfig, "directory", name);
			}
			config.directories = directories;
		}

		// Databases - generate imports for modules
		if (rawConfig.databases && Object.keys(rawConfig.databases).length > 0) {
			const databases: Record<string, unknown> = {};
			for (const [name, dbConfig] of Object.entries(rawConfig.databases)) {
				databases[name] = reifyModule(dbConfig, "database", name);
			}
			config.databases = databases;
		}

		return config;
	};

	// Build the config object
	const config = buildConfig();

	// Convert to JavaScript object literal (not JSON - unquoted keys where valid)
	const {code: configCode} = toJSLiteral(config, placeholders, "");

	// Check if tmpdir() is used in the generated code - if so, add the import
	const needsTmpdirImport = configCode.includes("tmpdir()");
	if (needsTmpdirImport) {
		imports.unshift('import {tmpdir} from "os";');
	}

	// Provider imports (cache modules, directory modules, etc.)
	const providerImports = imports.length > 0 ? `${imports.join("\n")}\n` : "";

	return `${providerImports}
export const config = ${configCode};
`;
}

/**
 * Load raw config from shovel.json without processing expressions.
 * Used at build time to get the config before code generation.
 */
export function loadRawConfig(cwd: string): ShovelConfig {
	let rawConfig: unknown = {};
	let configSource = "defaults";

	// Try shovel.json first
	try {
		const shovelPath = `${cwd}/shovel.json`;
		const content = readFileSync(shovelPath, "utf-8");
		rawConfig = JSON.parse(content);
		configSource = "shovel.json";
	} catch (error: any) {
		if (error?.code !== "ENOENT") {
			throw error;
		}

		// Try package.json
		try {
			const pkgPath = `${cwd}/package.json`;
			const content = readFileSync(pkgPath, "utf-8");
			const pkgJSON = JSON.parse(content);
			if (pkgJSON.shovel) {
				rawConfig = pkgJSON.shovel;
				configSource = "package.json";
			}
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				throw error;
			}
		}
	}

	// Validate config with Zod (throws on invalid config)
	try {
		return ShovelConfigSchema.parse(rawConfig);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const issues = error.issues
				.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
				.join("\n");
			throw new Error(`Invalid config in ${configSource}:\n${issues}`);
		}
		throw error;
	}
}

// ============================================================================
// CONFIG SCHEMA (Zod-validated)
// ============================================================================

/** Config expression: string or number (evaluated at runtime) */
const configExpr = z.union([z.string(), z.number()]);

/** Cache configuration schema */
export const CacheConfigSchema = z
	.object({
		module: z.string().optional(),
		export: z.string().optional(),
		url: configExpr.optional(),
		maxEntries: configExpr.optional(),
		TTL: configExpr.optional(),
	})
	.strict();

export type CacheConfig = z.infer<typeof CacheConfigSchema>;

/** Directory configuration schema */
export const DirectoryConfigSchema = z
	.object({
		module: z.string().optional(),
		export: z.string().optional(),
		path: configExpr.optional(),
		binding: configExpr.optional(),
		bucket: configExpr.optional(),
		region: configExpr.optional(),
		endpoint: configExpr.optional(),
	})
	.strict();

export type DirectoryConfig = z.infer<typeof DirectoryConfigSchema>;

/** Database configuration schema - uses module/export pattern like directories/caches */
export const DatabaseConfigSchema = z
	.object({
		/** Module path to import (e.g., "@b9g/zen/bun") */
		module: z.string(),
		/** Named export to use (defaults to "default") */
		export: z.string().optional(),
		/** Database connection URL */
		url: z.string(),
	})
	.passthrough(); // Allow additional driver-specific options (max, idleTimeout, etc.)

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

/** Log level for filtering */
export const LogLevelSchema = z.enum(["debug", "info", "warning", "error"]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

/** Sink configuration schema - allows extra provider-specific options */
export const SinkConfigSchema = z
	.object({
		module: z.string(),
		export: z.string().optional(),
	})
	.passthrough(); // Allow additional sink-specific options (path, maxSize, etc.)

export type SinkConfig = z.infer<typeof SinkConfigSchema> & {
	/** Reified implementation (factory function from build-time code generation) */
	impl?: (options: Record<string, unknown>) => unknown;
};

/** Logger configuration schema */
export const LoggerConfigSchema = z
	.object({
		category: z.union([z.string(), z.array(z.string())]),
		level: LogLevelSchema.optional(),
		sinks: z.array(z.string()).optional(),
		parentSinks: z.literal("override").optional(),
	})
	.strict();

export type LoggerConfig = z.infer<typeof LoggerConfigSchema>;

/** Logging configuration schema */
export const LoggingConfigSchema = z
	.object({
		sinks: z.record(z.string(), SinkConfigSchema).optional(),
		loggers: z.array(LoggerConfigSchema).optional(),
	})
	.strict();

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

/** Main Shovel configuration schema */
export const ShovelConfigSchema = z
	.object({
		platform: z.string().optional(),
		port: z.union([z.number(), z.string()]).optional(),
		host: z.string().optional(),
		workers: z.union([z.number(), z.string()]).optional(),
		logging: LoggingConfigSchema.optional(),
		caches: z.record(z.string(), CacheConfigSchema).optional(),
		directories: z.record(z.string(), DirectoryConfigSchema).optional(),
		databases: z.record(z.string(), DatabaseConfigSchema).optional(),
	})
	.strict();

export type ShovelConfig = z.infer<typeof ShovelConfigSchema>;

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
	databases: Record<string, DatabaseConfig>;
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
		databases: processed.databases || {},
	};

	return config;
}

// ============================================================================
// STORAGE TYPE GENERATION
// ============================================================================

/**
 * Options for generating storage types
 */
export interface GenerateStorageTypesOptions {
	/** Platform-specific defaults for directories, caches, etc. */
	platformDefaults?: {
		directories?: Record<string, unknown>;
		caches?: Record<string, unknown>;
	};
}

/**
 * Generate TypeScript declaration file with typed overloads for storage APIs.
 * Called at build time to create shovel.d.ts with compile-time validation.
 *
 * @param config - Raw shovel config (from loadRawConfig)
 * @param options - Options including platform defaults to merge
 * @returns Generated TypeScript declaration file content, or empty string if nothing to generate
 */
export function generateStorageTypes(
	config: ShovelConfig,
	options: GenerateStorageTypesOptions = {},
): string {
	const {platformDefaults = {}} = options;

	// Merge platform defaults with user config (user config takes precedence)
	const mergedDirectories = {
		...(platformDefaults.directories || {}),
		...(config.directories || {}),
	};
	const mergedCaches = {
		...(platformDefaults.caches || {}),
		...(config.caches || {}),
	};

	const databaseNames = config.databases ? Object.keys(config.databases) : [];
	const directoryNames = Object.keys(mergedDirectories);
	const cacheNames = Object.keys(mergedCaches);

	if (
		databaseNames.length === 0 &&
		directoryNames.length === 0 &&
		cacheNames.length === 0
	) {
		return "";
	}

	const imports: string[] = [];
	const sections: string[] = [];

	// Generate database type (union of valid names)
	if (databaseNames.length > 0) {
		imports.push(`import type {Database} from "@b9g/zen";`);
		imports.push(`import type {DatabaseUpgradeEvent} from "@b9g/platform";`);

		const dbUnion = databaseNames.map((n) => `"${n}"`).join(" | ");
		sections.push(`  /**
   * Valid database names from shovel.json.
   * Using an invalid name will cause a TypeScript error.
   */
  type ValidDatabaseName = ${dbUnion};

  interface DatabaseStorage {
    /** Open a database at a specific version, running migrations if needed */
    open(
      name: ValidDatabaseName,
      version: number,
      onUpgrade?: (event: DatabaseUpgradeEvent) => void,
    ): Promise<Database>;
    /** Get an already-opened database (throws if not opened) */
    get(name: ValidDatabaseName): Database;
    /** Close a specific database */
    close(name: ValidDatabaseName): Promise<void>;
    /** Close all databases */
    closeAll(): Promise<void>;
  }`);
	}

	// Generate directory type (union of valid names)
	if (directoryNames.length > 0) {
		const dirUnion = directoryNames.map((n) => `"${n}"`).join(" | ");
		sections.push(`  /**
   * Valid directory names from shovel.json and platform defaults.
   * Using an invalid name will cause a TypeScript error.
   */
  type ValidDirectoryName = ${dirUnion};

  interface DirectoryStorage {
    open(name: ValidDirectoryName): Promise<FileSystemDirectoryHandle>;
    has(name: ValidDirectoryName): Promise<boolean>;
  }`);
	}

	// Generate cache type (union of valid names)
	if (cacheNames.length > 0) {
		const cacheUnion = cacheNames.map((n) => `"${n}"`).join(" | ");
		sections.push(`  /**
   * Valid cache names from shovel.json and platform defaults.
   * Using an invalid name will cause a TypeScript error.
   */
  type ValidCacheName = ${cacheUnion};

  interface CacheStorage {
    open(name: ValidCacheName): Promise<Cache>;
    has(name: ValidCacheName): Promise<boolean>;
    delete(name: ValidCacheName): Promise<boolean>;
    keys(): Promise<string[]>;
  }`);
	}

	return `// Generated by Shovel - DO NOT EDIT
// This file provides typed overloads for self.databases, self.directories, and self.caches
${imports.join("\n")}

declare global {
${sections.join("\n\n")}
}

export {};
`;
}
