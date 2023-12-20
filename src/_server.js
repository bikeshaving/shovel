import {createServer} from "http";

function readableStreamFromMessage(req) {
	return new ReadableStream({
		start(controller) {
			req.on("data", (chunk) => {
				controller.enqueue(chunk);
			});

			req.on("end", () => {
				controller.close();
			});
		},

		cancel() {
			req.destroy();
		},
	});
}

function createRequestFromNode(req) {
	const url = new URL(req.url || "/", "http://" + req.headers.host);
	const headers = new Headers();
	for (const key in req.headers) {
		if (req.headers[key]) {
			headers.append(key, req.headers[key]);
		}
	}

	return new Request(url, {
		method: req.method,
		headers,
		body: req.method === "GET" || req.method === "HEAD" ? undefined : readableStreamFromMessage(req),
	});
}

async function writeNodeResponse(res, webRes) {
  const headers = {};
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(webRes.status, headers);

  const reader = webRes.body.getReader();
	// Why isn’t the reader async iterable???
	while (true) {
		const {value, done} = await reader.read();
		if (done) {
			res.end();
			return;
		}

		res.write(value);
	}
}

export function createFetchServer(handler) {
	return createServer(async (req, res) => {
		const webRes = await handler(createRequestFromNode(req));
		await writeNodeResponse(res, webRes);
	});
}
