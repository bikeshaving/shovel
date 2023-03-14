console.log("HI");

function thrower() {
	throw new Error("This is an error");
}

export default function noop() {
	thrower();
}
