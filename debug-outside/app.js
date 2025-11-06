self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Outside Test"));
});