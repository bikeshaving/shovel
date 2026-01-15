import {jsx, Raw} from "@b9g/crank/standalone";
import type {Children, Context} from "@b9g/crank";
import {extractCritical} from "@emotion/server";
import {Navbar} from "./navbar.js";
import {assets} from "../server.js";

export function* Root(
	this: Context,
	{
		title,
		children,
		url,
		description = "",
	}: {
		title: string;
		children: Children;
		url: string;
		description?: string;
	},
) {
	for ({title, children, url, description = ""} of this) {
		this.schedule(() => this.refresh());
		const childrenHTML: string = yield jsx`
			<div id="navbar-root">
				<${Navbar} url=${url} />
			</div>
			${children}
		`;
		const {html, css} = extractCritical(childrenHTML);
		yield jsx`
			<${Raw} value="<!DOCTYPE html>" />
			<html lang="en">
				<head>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width" />
					<title>${title}</title>
					<style>${css}</style>
					<link rel="stylesheet" type="text/css" href=${assets.clientCSS} />
					<meta name="description" content=${description} />
					<meta property="og:title" content=${title} />
					<meta property="og:description" content=${description} />
					<meta property="og:type" content="website" />
					<meta property="og:site_name" content="Shovel" />
				</head>
				<body>
					<${Raw} value=${html} />
				</body>
			</html>
		`;
	}
}
