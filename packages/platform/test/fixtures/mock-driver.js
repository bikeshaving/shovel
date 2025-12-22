export let lastUrl;
export let lastOptions;
export let lastDriver;
export let closeCalls = 0;

export function reset() {
	lastUrl = undefined;
	lastOptions = undefined;
	lastDriver = undefined;
	closeCalls = 0;
}

class BaseDriver {
	constructor(url, options) {
		lastUrl = url;
		lastOptions = options;
	}

	async close() {
		closeCalls += 1;
	}
}

export class NamedDriver extends BaseDriver {
	constructor(url, options) {
		super(url, options);
		lastDriver = "NamedDriver";
	}
}

export default class DefaultDriver extends BaseDriver {
	constructor(url, options) {
		super(url, options);
		lastDriver = "default";
	}
}
