self.addEventListener("fetch", e => e.respondWith(new Response("single worker test")));
