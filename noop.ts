function thrower(): never {
	console.log("hi");
	throw new Error("This is an error");
}

export default function noop() {
	thrower();
}
