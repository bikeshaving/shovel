function thrower(shouldThrow) {
	if (shouldThrow) {
		throw new Error("throwing");
	}
}

export default function noop() {
	thrower(false);
	return "helo";
}
