export class Hot {
	constructor() {
		// TODO: Hide these
		this.declined = false;
		this.acceptCalls = [];
		this.disposeCalls = [];
	}

	accept(deps, callback) {
		if (callback == null) {
			callback = deps;
			deps = undefined;
		} else if	(typeof deps === "string") {
			deps = [deps];
		}

		this.acceptCalls.push({deps, callback});
		if (callback) {
			throw new Error("Not implemented");
		}
	}

	invalidate() {
		this.declined = true;
	}

	dispose(callback) {
		this.disposeCalls.push(args);
	}

	decline() {
		this.declined = true;
	}
}
