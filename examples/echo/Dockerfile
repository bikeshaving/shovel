FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Expose port
EXPOSE 3000

# Run the app
CMD ["bun", "run", "start"]
