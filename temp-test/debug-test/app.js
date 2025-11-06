self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Debug Test"));
});