self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("<marquee>Hello world</marquee>", {
		headers: {"content-type": "text/html; charset=UTF-8"},
	}));
});