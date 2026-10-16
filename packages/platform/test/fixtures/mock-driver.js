export const calls = {
	url: undefined,
	options: undefined,
	driver: undefined,
	close: 0,
};

export function reset() {
	calls.url = undefined;
	calls.options = undefined;
	calls.driver = undefined;
	calls.close = 0;
}

class BaseDriver {
	constructor(url, options) {
		calls.url = url;
		calls.options = options;
	}

	async close() {
		calls.close += 1;
	}
}

export class NamedDriver extends BaseDriver {
	constructor(url, options) {
		super(url, options);
		calls.driver = "NamedDriver";
	}
}

export default class DefaultDriver extends BaseDriver {
	constructor(url, options) {
		super(url, options);
		calls.driver = "default";
	}
}
