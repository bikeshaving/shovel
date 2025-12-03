self.addEventListener("fetch", (event) => {
	event.respondWith(
		(async () => {
			const cookieStore = self.cookieStore;
			const testCookie = await cookieStore.get("test");

			return new Response(
				JSON.stringify({
					cookieValue: testCookie?.value || null,
				}),
				{
					headers: {"Content-Type": "application/json"},
				},
			);
		})(),
	);
});
