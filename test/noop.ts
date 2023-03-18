function thrower(shouldThrow) {
	if (shouldThrow) {
		throw new Error("throwing");
	}
}

export default async function noop() {
	thrower(false);

	return (await import("./doop")).doop;
}

export let test = "to";
