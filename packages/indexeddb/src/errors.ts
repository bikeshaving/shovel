/**
 * DOMException subclasses for IndexedDB errors.
 *
 * IndexedDB uses DOMException with specific names. We create helpers
 * since DOMException is a global in modern runtimes.
 */

export function createDOMException(
	message: string,
	name: string,
): DOMException {
	return new DOMException(message, name);
}

export function ConstraintError(message: string): DOMException {
	return createDOMException(message, "ConstraintError");
}

export function DataError(message: string): DOMException {
	return createDOMException(message, "DataError");
}

export function InvalidStateError(message: string): DOMException {
	return createDOMException(message, "InvalidStateError");
}

export function NotFoundError(message: string): DOMException {
	return createDOMException(message, "NotFoundError");
}

export function ReadOnlyError(message: string): DOMException {
	return createDOMException(message, "ReadOnlyError");
}

export function TransactionInactiveError(message: string): DOMException {
	return createDOMException(message, "TransactionInactiveError");
}

export function VersionError(message: string): DOMException {
	return createDOMException(message, "VersionError");
}

export function AbortError(message: string): DOMException {
	return createDOMException(message, "AbortError");
}

export function InvalidAccessError(message: string): DOMException {
	return createDOMException(message, "InvalidAccessError");
}

export function DataCloneError(message: string): DOMException {
	return createDOMException(message, "DataCloneError");
}
