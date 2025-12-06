/**
 * Standard HTTP error classes with native cause support and automatic serialization
 */

/** HTTP status codes and their default messages */
const STATUS_CODE_DEFAULTS: Record<number, string> = {
	// 4xx Client Errors
	400: "Bad Request",
	401: "Unauthorized",
	402: "Payment Required",
	403: "Forbidden",
	404: "Not Found",
	405: "Method Not Allowed",
	406: "Not Acceptable",
	407: "Proxy Authentication Required",
	408: "Request Timeout",
	409: "Conflict",
	410: "Gone",
	411: "Length Required",
	412: "Precondition Failed",
	413: "Payload Too Large",
	414: "URI Too Long",
	415: "Unsupported Media Type",
	416: "Range Not Satisfiable",
	417: "Expectation Failed",
	418: "I'm a Teapot",
	421: "Misdirected Request",
	422: "Unprocessable Entity",
	423: "Locked",
	424: "Failed Dependency",
	425: "Too Early",
	426: "Upgrade Required",
	428: "Precondition Required",
	429: "Too Many Requests",
	431: "Request Header Fields Too Large",
	451: "Unavailable For Legal Reasons",

	// 5xx Server Errors
	500: "Internal Server Error",
	501: "Not Implemented",
	502: "Bad Gateway",
	503: "Service Unavailable",
	504: "Gateway Timeout",
	505: "HTTP Version Not Supported",
	506: "Variant Also Negotiates",
	507: "Insufficient Storage",
	508: "Loop Detected",
	510: "Not Extended",
	511: "Network Authentication Required",
};

const HTTP_ERROR = Symbol.for("shovel.http-error");

/** Options for creating HTTP errors */
export interface HTTPErrorOptions {
	/** Original error that caused this HTTP error */
	cause?: Error;
	/** Custom headers to include in the error */
	headers?: Record<string, string>;
	/** Whether the error details should be exposed to clients (defaults based on status) */
	expose?: boolean;
}

/** Base HTTP error class */
export class HTTPError extends Error {
	readonly status: number;
	readonly expose: boolean;
	readonly headers?: Record<string, string>;

	constructor(
		status: number,
		message?: string,
		options: HTTPErrorOptions = {},
	) {
		const defaultMessage = STATUS_CODE_DEFAULTS[status] || "Unknown Error";
		super(message || defaultMessage, {cause: options.cause});

		this.name = this.constructor.name;
		this.status = status;
		this.expose = options.expose ?? status < 500; // Expose client errors by default
		this.headers = options.headers;

		// Attach any additional properties
		Object.assign(this, options);
	}

	get statusCode(): number {
		return this.status;
	}

	/**
	 * Convert error to a plain object for serialization
	 */
	toJSON() {
		return {
			name: this.name,
			message: this.message,
			status: this.status,
			statusCode: this.statusCode,
			expose: this.expose,
			headers: this.headers,
		};
	}

	/**
	 * Convert error to an HTTP Response
	 * In development mode, shows detailed error page with stack trace
	 * In production mode, shows minimal error message
	 */
	toResponse(isDev?: boolean): Response {
		const headers = new Headers(this.headers);

		if (isDev && this.expose) {
			headers.set("Content-Type", "text/html; charset=utf-8");
			const statusText = STATUS_CODE_DEFAULTS[this.status] || "Unknown Error";
			const html = `<!DOCTYPE html>
<html>
<head>
  <title>${this.status} ${escapeHTML(statusText)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
    h1 { color: ${this.status >= 500 ? "#c00" : "#e67700"}; }
    .message { font-size: 1.2em; color: #333; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${this.status} ${escapeHTML(statusText)}</h1>
  <p class="message">${escapeHTML(this.message)}</p>
  <pre>${escapeHTML(this.stack || "No stack trace available")}</pre>
</body>
</html>`;
			return new Response(html, {
				status: this.status,
				statusText,
				headers,
			});
		}

		// Production mode: plain text, minimal info
		headers.set("Content-Type", "text/plain; charset=utf-8");
		const body = this.expose
			? this.message
			: STATUS_CODE_DEFAULTS[this.status] || "Unknown Error";
		return new Response(body, {
			status: this.status,
			statusText: STATUS_CODE_DEFAULTS[this.status],
			headers,
		});
	}
}

(HTTPError.prototype as any)[HTTP_ERROR] = true;

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHTML(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Check if a value is an HTTP error
 */
export function isHTTPError(value: any): value is HTTPError {
	return !!(value && value[HTTP_ERROR]);
}

// Common 4xx client error classes
export class BadRequest extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(400, message, options);
	}
}

export class Unauthorized extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(401, message, options);
	}
}

export class Forbidden extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(403, message, options);
	}
}

export class NotFound extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(404, message, options);
	}
}

export class MethodNotAllowed extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(405, message, options);
	}
}

export class Conflict extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(409, message, options);
	}
}

export class UnprocessableEntity extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(422, message, options);
	}
}

export class TooManyRequests extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(429, message, options);
	}
}

// Common 5xx server error classes
export class InternalServerError extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(500, message, options);
	}
}

export class NotImplemented extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(501, message, options);
	}
}

export class BadGateway extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(502, message, options);
	}
}

export class ServiceUnavailable extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(503, message, options);
	}
}

export class GatewayTimeout extends HTTPError {
	constructor(message?: string, options?: HTTPErrorOptions) {
		super(504, message, options);
	}
}
