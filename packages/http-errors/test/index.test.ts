import {test, expect, describe} from "bun:test";
import {
	HTTPError,
	NotHandled,
	isHTTPError,
	createHTTPError,
	BadRequest,
	Unauthorized,
	Forbidden,
	NotFound,
	MethodNotAllowed,
	Conflict,
	UnprocessableEntity,
	TooManyRequests,
	InternalServerError,
	NotImplemented,
	BadGateway,
	ServiceUnavailable,
	GatewayTimeout,
} from "../src/index.js";

describe("HTTPError", () => {
	test("should create basic error with status code", () => {
		const error = new HTTPError(404);

		expect(error.status).toBe(404);
		expect(error.statusCode).toBe(404);
		expect(error.message).toBe("Not Found");
		expect(error.name).toBe("HTTPError");
		expect(error.expose).toBe(true); // 4xx errors expose by default
	});

	test("should create error with custom message", () => {
		const error = new HTTPError(404, "Page not found");

		expect(error.status).toBe(404);
		expect(error.message).toBe("Page not found");
	});

	test("should handle cause option", () => {
		const originalError = new Error("Database connection failed");
		const error = new HTTPError(500, "Server Error", {cause: originalError});

		expect(error.cause).toBe(originalError);
	});

	test("should handle headers option", () => {
		const headers = {"Retry-After": "60"};
		const error = new HTTPError(429, undefined, {headers});

		expect(error.headers).toEqual(headers);
	});

	test("should respect expose option", () => {
		const error1 = new HTTPError(500, undefined, {expose: true});
		const error2 = new HTTPError(400, undefined, {expose: false});

		expect(error1.expose).toBe(true);
		expect(error2.expose).toBe(false);
	});

	test("should default expose based on status code", () => {
		const clientError = new HTTPError(400);
		const serverError = new HTTPError(500);

		expect(clientError.expose).toBe(true); // 4xx should expose
		expect(serverError.expose).toBe(false); // 5xx should not expose
	});

	test("should handle additional properties", () => {
		const error = new HTTPError(400, "Bad Request", {
			code: "VALIDATION_FAILED",
			details: {field: "email"},
		});

		expect(error.code).toBe("VALIDATION_FAILED");
		expect(error.details).toEqual({field: "email"});
	});

	test("toJSON should serialize correctly", () => {
		const error = new HTTPError(404, "Not Found", {
			headers: {"Cache-Control": "no-cache"},
		});

		const json = error.toJSON();
		expect(json).toEqual({
			name: "HTTPError",
			message: "Not Found",
			status: 404,
			statusCode: 404,
			expose: true,
			headers: {"Cache-Control": "no-cache"},
		});
	});

	test("toResponse should create correct Response for exposed error", () => {
		const error = new HTTPError(404, "Page not found", {
			headers: {"X-Error-Code": "NOT_FOUND"},
		});

		const response = error.toResponse();
		expect(response.status).toBe(404);
		expect(response.statusText).toBe("Not Found");
		expect(response.headers.get("X-Error-Code")).toBe("NOT_FOUND");

		// Should expose custom message for 4xx
		return response.text().then((text) => {
			expect(text).toBe("Page not found");
		});
	});

	test("toResponse should hide message for unexposed server error", () => {
		const error = new HTTPError(500, "Database connection failed");

		const response = error.toResponse();
		expect(response.status).toBe(500);

		// Should use default message for 5xx
		return response.text().then((text) => {
			expect(text).toBe("Internal Server Error");
		});
	});
});

describe("NotHandled", () => {
	test("should create NotHandled error", () => {
		const error = new NotHandled();

		expect(error.name).toBe("NotHandled");
		expect(error.message).toBe("Request not handled by middleware");
	});

	test("should create NotHandled with custom message", () => {
		const error = new NotHandled("Custom message");

		expect(error.message).toBe("Custom message");
	});
});

describe("isHTTPError", () => {
	test("should identify HTTPError instances", () => {
		const error = new HTTPError(404);
		expect(isHTTPError(error)).toBe(true);
	});

	test("should identify error-like objects with status properties", () => {
		const errorLike = {
			status: 404,
			statusCode: 404,
			message: "Not Found",
		};
		Object.setPrototypeOf(errorLike, Error.prototype);

		expect(isHTTPError(errorLike)).toBe(true);
	});

	test("should reject regular errors", () => {
		const error = new Error("Regular error");
		expect(isHTTPError(error)).toBe(false);
	});

	test("should reject non-errors", () => {
		expect(isHTTPError("string")).toBe(false);
		expect(isHTTPError(null)).toBe(false);
		expect(isHTTPError(undefined)).toBe(false);
		expect(isHTTPError({})).toBe(false);
	});

	test("should reject objects with mismatched status codes", () => {
		const errorLike = {
			status: 404,
			statusCode: 500,
			message: "Mismatch",
		};
		Object.setPrototypeOf(errorLike, Error.prototype);

		expect(isHTTPError(errorLike)).toBe(false);
	});
});

describe("createHTTPError", () => {
	test("should create HTTPError with factory function", () => {
		const error = createHTTPError(404, "Not Found");

		expect(error).toBeInstanceOf(HTTPError);
		expect(error.status).toBe(404);
		expect(error.message).toBe("Not Found");
	});
});

describe("Specific Error Classes", () => {
	describe("4xx Client Errors", () => {
		test("BadRequest (400)", () => {
			const error = new BadRequest("Invalid input");
			expect(error.status).toBe(400);
			expect(error.message).toBe("Invalid input");
			expect(error.expose).toBe(true);
		});

		test("Unauthorized (401)", () => {
			const error = new Unauthorized();
			expect(error.status).toBe(401);
			expect(error.message).toBe("Unauthorized");
		});

		test("Forbidden (403)", () => {
			const error = new Forbidden("Access denied");
			expect(error.status).toBe(403);
			expect(error.message).toBe("Access denied");
		});

		test("NotFound (404)", () => {
			const error = new NotFound();
			expect(error.status).toBe(404);
			expect(error.message).toBe("Not Found");
		});

		test("MethodNotAllowed (405)", () => {
			const error = new MethodNotAllowed("POST not allowed");
			expect(error.status).toBe(405);
			expect(error.message).toBe("POST not allowed");
		});

		test("Conflict (409)", () => {
			const error = new Conflict("Resource already exists");
			expect(error.status).toBe(409);
			expect(error.message).toBe("Resource already exists");
		});

		test("UnprocessableEntity (422)", () => {
			const error = new UnprocessableEntity("Validation failed");
			expect(error.status).toBe(422);
			expect(error.message).toBe("Validation failed");
		});

		test("TooManyRequests (429)", () => {
			const error = new TooManyRequests("Rate limit exceeded");
			expect(error.status).toBe(429);
			expect(error.message).toBe("Rate limit exceeded");
		});
	});

	describe("5xx Server Errors", () => {
		test("InternalServerError (500)", () => {
			const error = new InternalServerError();
			expect(error.status).toBe(500);
			expect(error.message).toBe("Internal Server Error");
			expect(error.expose).toBe(false);
		});

		test("NotImplemented (501)", () => {
			const error = new NotImplemented("Feature not implemented");
			expect(error.status).toBe(501);
			expect(error.message).toBe("Feature not implemented");
		});

		test("BadGateway (502)", () => {
			const error = new BadGateway();
			expect(error.status).toBe(502);
			expect(error.message).toBe("Bad Gateway");
		});

		test("ServiceUnavailable (503)", () => {
			const error = new ServiceUnavailable("Maintenance mode");
			expect(error.status).toBe(503);
			expect(error.message).toBe("Maintenance mode");
		});

		test("GatewayTimeout (504)", () => {
			const error = new GatewayTimeout("Upstream timeout");
			expect(error.status).toBe(504);
			expect(error.message).toBe("Upstream timeout");
		});
	});

	test("All error classes should accept options", () => {
		const headers = {"X-Custom": "value"};
		const cause = new Error("Original error");

		const error = new BadRequest("Custom message", {headers, cause});

		expect(error.headers).toBe(headers);
		expect(error.cause).toBe(cause);
	});
});

describe("Edge Cases", () => {
	test("should handle unknown status codes", () => {
		const error = new HTTPError(999);
		expect(error.status).toBe(999);
		expect(error.message).toBe("Unknown Error");
	});

	test("should work with inheritance", () => {
		class CustomError extends HTTPError {
			constructor(message?: string) {
				super(418, message);
				this.name = "CustomError";
			}
		}

		const error = new CustomError("I'm a teapot");
		expect(error).toBeInstanceOf(HTTPError);
		expect(error).toBeInstanceOf(CustomError);
		expect(error.status).toBe(418);
		expect(error.name).toBe("CustomError");
	});

	test("should preserve Error behavior", () => {
		const error = new HTTPError(500, "Server Error");

		expect(error instanceof Error).toBe(true);
		expect(error.stack).toBeDefined();
		expect(typeof error.stack).toBe("string");
	});
});
