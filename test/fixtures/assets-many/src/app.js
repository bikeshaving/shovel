import "./style0.css" with {assetBase: "/assets/"};
import "./style1.css" with {assetBase: "/assets/"};
import "./style2.css" with {assetBase: "/assets/"};
import "./style3.css" with {assetBase: "/assets/"};
import "./style4.css" with {assetBase: "/assets/"};
import "./style5.css" with {assetBase: "/assets/"};
import "./style6.css" with {assetBase: "/assets/"};
import "./style7.css" with {assetBase: "/assets/"};
import "./style8.css" with {assetBase: "/assets/"};
import "./style9.css" with {assetBase: "/assets/"};

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Many assets loaded"));
});
