FROM oven/bun:1 as base
WORKDIR /usr/src/app

# Install dependencies first
COPY package.json ./
RUN echo 'registry=https://registry.npmjs.org/' > .npmrc && rm -f bun.lock* && bun install --production --force

# Copy pre-built app and database files
COPY dist/ ./dist/
COPY src/db/ ./src/db/

# Initialize database schema first
RUN bun -e "const { Database } = require('bun:sqlite'); const db = new Database('admin.db'); db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA foreign_keys = ON'); const schema = require('fs').readFileSync('./src/db/schema.sql', 'utf8'); db.exec(schema); console.log('Database schema initialized');"

# Seed database on startup
RUN bun src/db/seed.js

# Start the app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["bun", "dist/app.js"]