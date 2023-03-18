console.log(import.meta.url);
function thrower(shouldThrow) {
	if (shouldThrow) {
		throw new Error("throwing");
	}
}

export default function noop() {
	thrower(true);

	return "hello";
}

export let test = "test";
