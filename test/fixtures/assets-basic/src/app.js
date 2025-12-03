import "./style.css" with {assetBase: "assets"};

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/") {
		event.respondWith(
			new Response(
				`
			<!DOCTYPE html>
			<html>
				<head>
					<title>Asset Test</title>
					<link rel="stylesheet" href="/assets/style.css">
				</head>
				<body>
					<h1 class="header">Hello with Assets!</h1>
				</body>
			</html>
		`,
				{
					headers: {"content-type": "text/html; charset=utf-8"},
				},
			),
		);
	}
});
