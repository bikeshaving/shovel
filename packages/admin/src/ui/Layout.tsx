/**
 * @b9g/admin - Layout component
 *
 * Base layout for all admin pages using Crank.js
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
				<style>{`
					* { box-sizing: border-box; margin: 0; padding: 0; }
					body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1b1b1b; }
					.layout { display: flex; min-height: 100vh; }
					.sidebar { width: 250px; background: #1b1b1b; color: #fff; padding: 1rem; }
					.sidebar h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
					.sidebar nav a { display: block; color: #a9aeb1; text-decoration: none; padding: 0.5rem 0; }
					.sidebar nav a:hover { color: #fff; }
					.main { flex: 1; padding: 2rem; background: #f0f0f0; }
					.main h1 { margin-bottom: 1rem; }
					table { width: 100%; border-collapse: collapse; background: #fff; }
					th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #dfe1e2; }
					th { background: #f0f0f0; font-weight: 600; }
					tr:hover { background: #f7f7f7; }
					a { color: #005ea2; }
					.btn { display: inline-block; padding: 0.5rem 1rem; background: #005ea2; color: #fff; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; }
					.btn:hover { background: #1a4480; }
					.btn-danger { background: #b50909; }
					.btn-danger:hover { background: #8b0a03; }
					.card { background: #fff; padding: 1.5rem; border-radius: 4px; margin-bottom: 1rem; }
					.form-group { margin-bottom: 1rem; }
					.form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
					.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #dfe1e2; border-radius: 4px; }
					.pagination { display: flex; gap: 0.5rem; margin-top: 1rem; }
					.pagination a, .pagination span { padding: 0.5rem 0.75rem; border: 1px solid #dfe1e2; text-decoration: none; }
					.pagination a:hover { background: #f0f0f0; }
					.pagination .active { background: #005ea2; color: #fff; border-color: #005ea2; }
					.alert { padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
					.alert-success { background: #ecf3ec; border-left: 4px solid #00a91c; }
					.alert-error { background: #f4e3db; border-left: 4px solid #b50909; }
				`}</style>
			</head>
			<body>
				<div class="layout">
					<aside class="sidebar">
						<h1>
							<a href={basePath} style="color: inherit; text-decoration: none;">
								{title}
							</a>
						</h1>
						<nav>{children}</nav>
					</aside>
				</div>
			</body>
		</html>
	);
}

export interface PageLayoutProps {
	title: string;
	pageTitle: string;
	basePath: string;
	models: Array<{name: string; displayName: string}>;
	children: Children;
}

export function PageLayout({
	title,
	pageTitle,
	basePath,
	models,
	children,
}: PageLayoutProps) {
	return (
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>
					{pageTitle} - {title}
				</title>
				<style>{`
					* { box-sizing: border-box; margin: 0; padding: 0; }
					body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #1b1b1b; }
					.layout { display: flex; min-height: 100vh; }
					.sidebar { width: 250px; background: #1b1b1b; color: #fff; padding: 1rem; flex-shrink: 0; }
					.sidebar h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
					.sidebar h2 { font-size: 0.875rem; color: #a9aeb1; text-transform: uppercase; margin-bottom: 0.5rem; margin-top: 1rem; }
					.sidebar nav a { display: block; color: #a9aeb1; text-decoration: none; padding: 0.5rem 0; }
					.sidebar nav a:hover, .sidebar nav a.active { color: #fff; }
					.main { flex: 1; padding: 2rem; background: #f0f0f0; overflow-x: auto; }
					.main h1 { margin-bottom: 1rem; }
					table { width: 100%; border-collapse: collapse; background: #fff; }
					th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #dfe1e2; }
					th { background: #f0f0f0; font-weight: 600; }
					tr:hover { background: #f7f7f7; }
					a { color: #005ea2; }
					.btn { display: inline-block; padding: 0.5rem 1rem; background: #005ea2; color: #fff; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: 1rem; }
					.btn:hover { background: #1a4480; }
					.btn-secondary { background: #71767a; }
					.btn-secondary:hover { background: #565c65; }
					.btn-danger { background: #b50909; }
					.btn-danger:hover { background: #8b0a03; }
					.btn-sm { padding: 0.25rem 0.5rem; font-size: 0.875rem; }
					.card { background: #fff; padding: 1.5rem; border-radius: 4px; margin-bottom: 1rem; }
					.form-group { margin-bottom: 1rem; }
					.form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
					.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #dfe1e2; border-radius: 4px; font-size: 1rem; }
					.form-group textarea { min-height: 100px; }
					.form-actions { display: flex; gap: 0.5rem; margin-top: 1.5rem; }
					.pagination { display: flex; gap: 0.5rem; margin-top: 1rem; }
					.pagination a, .pagination span { padding: 0.5rem 0.75rem; border: 1px solid #dfe1e2; text-decoration: none; background: #fff; }
					.pagination a:hover { background: #f0f0f0; }
					.pagination .active { background: #005ea2; color: #fff; border-color: #005ea2; }
					.alert { padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
					.alert-success { background: #ecf3ec; border-left: 4px solid #00a91c; }
					.alert-error { background: #f4e3db; border-left: 4px solid #b50909; }
					.breadcrumb { margin-bottom: 1rem; color: #71767a; }
					.breadcrumb a { color: #005ea2; }
					.actions { display: flex; gap: 0.5rem; }
					.empty { padding: 2rem; text-align: center; color: #71767a; background: #fff; }
					dl { display: grid; grid-template-columns: 200px 1fr; gap: 0.5rem 1rem; }
					dt { font-weight: 500; color: #71767a; }
					dd { margin: 0; }
				`}</style>
			</head>
			<body>
				<div class="layout">
					<aside class="sidebar">
						<h1>
							<a href={basePath} style="color: inherit; text-decoration: none;">
								{title}
							</a>
						</h1>
						<h2>Models</h2>
						<nav>
							{models.map((m) => (
								<a href={`${basePath}/${m.name}`}>{m.displayName}</a>
							))}
						</nav>
					</aside>
					<main class="main">{children}</main>
				</div>
			</body>
		</html>
	);
}
