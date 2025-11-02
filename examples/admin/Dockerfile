FROM oven/bun:1 as base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source code and build
COPY . .
RUN bun run build

# Seed database on startup
RUN bun src/db/seed.js

# Start the app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["bun", "dist/app.js"]