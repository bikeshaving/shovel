/**
 * Modern HTTP error classes for Shovel
 * Lightweight alternative to http-errors with native Error cause support
 */

/**
 * HTTP status codes and their default messages
 */
const STATUS_CODES: Record<number, string> = {
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

/**
 * Options for creating HTTP errors
 */
export interface HTTPErrorOptions {
	/** Original error that caused this HTTP error */
	cause?: Error;
	/** Custom headers to include in the error */
	headers?: Record<string, string>;
	/** Whether the error details should be exposed to clients (defaults based on status) */
	expose?: boolean;
	/** Additional properties to attach to the error */
	[key: string]: any;
}

/**
 * Base HTTP error class
 */
export class HTTPError extends Error {
	public readonly status: number;
	public readonly statusCode: number;
	public readonly expose: boolean;
	public readonly headers?: Record<string, string>;

	constructor(
		status: number,
		message?: string,
		options: HTTPErrorOptions = {},
	) {
		const defaultMessage = STATUS_CODES[status] || "Unknown Error";
		super(message || defaultMessage, {cause: options.cause});

		this.name = this.constructor.name;
		this.status = this.statusCode = status;
		this.expose = options.expose ?? status < 500; // Expose client errors by default
		this.headers = options.headers;

		// Attach any additional properties
		Object.assign(this, options);
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
	 * Create a Response object from this error
	 */
	toResponse(): Response {
		const body = this.expose ? this.message : STATUS_CODES[this.status];
		return new Response(body, {
			status: this.status,
			statusText: STATUS_CODES[this.status],
			headers: this.headers,
		});
	}
}

/**
 * Special error for middleware fallthrough (not an HTTP error)
 */
export class NotHandled extends Error {
	constructor(message = "Request not handled by middleware") {
		super(message);
		this.name = "NotHandled";
	}
}

/**
 * Check if a value is an HTTP error
 */
export function isHTTPError(value: any): value is HTTPError {
	if (value instanceof HTTPError) return true;

	if (!(value instanceof Error)) return false;

	// Check if error has HTTP error properties
	const hasStatus = "status" in value && typeof value.status === "number";
	const hasStatusCode = "statusCode" in value && typeof value.statusCode === "number";

	return hasStatus && hasStatusCode && value.status === value.statusCode;
}

/**
 * Create an HTTP error with the given status code
 */
export function createHTTPError(
	status: number,
	message?: string,
	options?: HTTPErrorOptions,
): HTTPError {
	return new HTTPError(status, message, options);
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

// Default export for convenience
export default createHTTPError;
