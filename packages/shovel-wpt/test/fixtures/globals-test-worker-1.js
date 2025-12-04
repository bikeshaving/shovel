self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/test-caches") {
		event.respondWith(testCaches());
	} else if (url.pathname === "/test-buckets") {
		event.respondWith(testBuckets());
	} else if (url.pathname === "/test-cookiestore") {
		event.respondWith(testCookieStore(event.request));
	} else {
		event.respondWith(new Response("Unknown test route", {status: 404}));
	}
});

async function testCaches() {
	const result = {
		success: false,
		error: null,
		// Actual functionality tests
		canOpen: false,
		canPut: false,
		canMatch: false,
		canDelete: false,
		matchedValue: null,
	};

	try {
		// Test 1: Can we open a cache?
		const cache = await self.caches.open("contract-test-cache");
		result.canOpen = true;

		// Test 2: Can we put a request/response?
		const testUrl = "https://example.com/cached-item";
		const testBody = "cached-content-" + Date.now();
		await cache.put(testUrl, new Response(testBody));
		result.canPut = true;

		// Test 3: Can we match and get the content back?
		const matched = await cache.match(testUrl);
		if (matched) {
			result.matchedValue = await matched.text();
			result.canMatch = result.matchedValue === testBody;
		}

		// Test 4: Can we delete?
		const deleted = await cache.delete(testUrl);
		result.canDelete = deleted === true;

		// Cleanup
		await self.caches.delete("contract-test-cache");

		result.success =
			result.canOpen && result.canPut && result.canMatch && result.canDelete;
	} catch (error) {
		result.error = error.message;
	}

	return new Response(JSON.stringify(result), {
		headers: {"Content-Type": "application/json"},
	});
}

async function testBuckets() {
	const result = {
		success: false,
		error: null,
		// Actual functionality tests
		canOpen: false,
		canWrite: false,
		canRead: false,
		readValue: null,
	};

	try {
		// Test 1: Can we open a bucket?
		const bucket = await self.buckets.open("test-bucket");
		result.canOpen = bucket && bucket.kind === "directory";

		// Test 2: Can we write a file?
		const testContent = "bucket-test-content-" + Date.now();
		const writeHandle = await bucket.getFileHandle("contract-test.txt", {
			create: true,
		});
		const writable = await writeHandle.createWritable();
		await writable.write(testContent);
		await writable.close();
		result.canWrite = true;

		// Test 3: Can we read it back?
		const readHandle = await bucket.getFileHandle("contract-test.txt");
		const file = await readHandle.getFile();
		result.readValue = await file.text();
		result.canRead = result.readValue === testContent;

		// Cleanup
		await bucket.removeEntry("contract-test.txt");

		result.success = result.canOpen && result.canWrite && result.canRead;
	} catch (error) {
		result.error = error.message;
	}

	return new Response(JSON.stringify(result), {
		headers: {"Content-Type": "application/json"},
	});
}

async function testCookieStore(_request) {
	const result = {
		success: false,
		error: null,
		// Actual functionality tests
		canGet: false,
		canReadFromRequest: false,
		cookieValue: null,
	};

	try {
		// Test 1: Can we call get() without error?
		const cookie = await self.cookieStore.get("test");
		result.canGet = true;

		// Test 2: Did we read the cookie from the request?
		if (cookie) {
			result.cookieValue = cookie.value;
			result.canReadFromRequest = cookie.value === "value";
		}

		result.success = result.canGet && result.canReadFromRequest;
	} catch (error) {
		result.error = error.message;
	}

	return new Response(JSON.stringify(result), {
		headers: {"Content-Type": "application/json"},
	});
}
