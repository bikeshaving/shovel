self.addEventListener("fetch", (event) => {
	const cookieStore = self.cookieStore;
	event.respondWith(
		new Response(
			JSON.stringify({
				hasCookieStore: !!cookieStore,
				cookieStoreType: typeof cookieStore,
			}),
			{
				headers: {"Content-Type": "application/json"},
			},
		),
	);
});
