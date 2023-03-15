function thrower(): never {
	console.log("hi");
	//throw new Error("This is an error");
	return 1;
}

export default function noop() {
	thrower();
}
