self.addEventListener("fetch", (event) => {
	event.respondWith(
		(async () => {
			const cookieStore = self.cookieStore;
			const url = new URL(event.request.url);
			const requestId = url.searchParams.get("id");

			// Get the cookie from the request
			const cookie = await cookieStore.get("test");

			return new Response(
				JSON.stringify({
					requestId: requestId,
					cookieValue: cookie?.value || null,
				}),
				{
					headers: {"Content-Type": "application/json"},
				},
			);
		})(),
	);
});
