export class Hot {
	constructor() {
		this.disposeCallbacks = [];
	}

	// TODO: handle accept with basic callback and deps parameter
	accept(callback) {
		if (callback) {
			throw new Error("Not implemented");
		}
	}

	invalidate() {
		throw new Error("Not implemented");
	}

	dispose(callback) {
		this.disposeCallbacks.push(callback);
	}

	decline() {
		// pass
	}
}

export function disposeHot(hot) {
	for (const callback of hot.disposeCallbacks) {
		callback();
	}
}

