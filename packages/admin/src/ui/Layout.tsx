/**
 * @b9g/admin - Layout component
 *
 * Base layout for all admin pages using Crank.js and USWDS
 */

import type {Children} from "@b9g/crank";

export interface LayoutProps {
	title: string;
	basePath: string;
	children: Children;
}

export function Layout({title, basePath, children}: LayoutProps) {
	return (
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>{title}</title>
				<link rel="stylesheet" href={`${basePath}/uswds/css/uswds.min.css`} />
			</head>
			<body>
				{children}
				<script src={`${basePath}/uswds/js/uswds.min.js`} />
			</body>
		</html>
	);
}

export interface UswdsAssets {
	css: string;
	js: string;
}

export interface PageLayoutProps {
	title: string;
	pageTitle: string;
	basePath: string;
	models: Array<{name: string; displayName: string}>;
	assets?: UswdsAssets;
	children: Children;
}

// Default USWDS asset paths (relative to basePath)
const DEFAULT_ASSETS: UswdsAssets = {
	css: "/uswds/css/uswds.min.css",
	js: "/uswds/js/uswds.min.js",
};

export function PageLayout({
	title,
	pageTitle,
	basePath,
	models,
	assets,
	children,
}: PageLayoutProps) {
	// Use provided assets or fall back to defaults with basePath prefix
	const cssUrl = assets?.css ?? `${basePath}${DEFAULT_ASSETS.css}`;
	const jsUrl = assets?.js ?? `${basePath}${DEFAULT_ASSETS.js}`;

	return (
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>
					{pageTitle} - {title}
				</title>
				<link rel="stylesheet" href={cssUrl} />
				<style>{`
					/* Admin-specific overrides */
					.admin-layout {
						display: flex;
						min-height: 100vh;
					}
					.admin-sidebar {
						width: 256px;
						background: #1b1b1b;
						flex-shrink: 0;
					}
					.admin-sidebar .usa-sidenav {
						background: transparent;
						border: none;
					}
					.admin-sidebar .usa-sidenav__item {
						border: none;
					}
					.admin-sidebar .usa-sidenav a {
						color: #a9aeb1;
						padding: 0.75rem 1rem;
					}
					.admin-sidebar .usa-sidenav a:hover {
						color: #fff;
						background: #2d2d2d;
					}
					.admin-sidebar .usa-sidenav a.usa-current {
						color: #fff;
						background: #005ea2;
					}
					.admin-sidebar h1 {
						color: #fff;
						font-size: 1.25rem;
						padding: 1rem;
						margin: 0;
					}
					.admin-sidebar h1 a {
						color: inherit;
						text-decoration: none;
					}
					.admin-sidebar h2 {
						color: #a9aeb1;
						font-size: 0.75rem;
						text-transform: uppercase;
						padding: 1rem 1rem 0.5rem;
						margin: 0;
						letter-spacing: 0.05em;
					}
					.admin-main {
						flex: 1;
						background: #f0f0f0;
						padding: 2rem;
						overflow-x: auto;
					}
					.admin-breadcrumb {
						margin-bottom: 1rem;
					}
					.admin-header {
						display: flex;
						justify-content: space-between;
						align-items: center;
						margin-bottom: 1.5rem;
					}
					.admin-header h1 {
						margin: 0;
					}
					.admin-card {
						background: #fff;
						padding: 1.5rem;
						border-radius: 4px;
						margin-bottom: 1rem;
					}
					.admin-empty {
						padding: 2rem;
						text-align: center;
						color: #71767a;
						background: #fff;
						border-radius: 4px;
					}
					/* Table improvements */
					.usa-table {
						width: 100%;
					}
					.usa-table th {
						background: #f0f0f0;
					}
					/* Detail view */
					.admin-detail dl {
						display: grid;
						grid-template-columns: 200px 1fr;
						gap: 0.5rem 1rem;
					}
					.admin-detail dt {
						font-weight: 600;
						color: #71767a;
					}
					.admin-detail dd {
						margin: 0;
					}
					/* Form improvements */
					.admin-form .usa-form-group {
						margin-bottom: 1.5rem;
					}
					.admin-form-actions {
						display: flex;
						gap: 0.5rem;
						margin-top: 2rem;
						padding-top: 1.5rem;
						border-top: 1px solid #dfe1e2;
					}
				`}</style>
			</head>
			<body>
				<div class="admin-layout">
					<aside class="admin-sidebar">
						<h1>
							<a href={basePath}>{title}</a>
						</h1>
						<h2>Models</h2>
						<nav>
							<ul class="usa-sidenav">
								{models.map((m) => (
									<li class="usa-sidenav__item">
										<a href={`${basePath}/${m.name}`}>{m.displayName}</a>
									</li>
								))}
							</ul>
						</nav>
					</aside>
					<main class="admin-main">{children}</main>
				</div>
				<script src={jsUrl} />
			</body>
		</html>
	);
}
