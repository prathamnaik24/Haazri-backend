# ─── Backend Development Dockerfile ──────────────────────────────────────────
#
# This is a DEVELOPMENT image — it uses nodemon for hot reloading.
# Source code is mounted as a volume in docker-compose so changes
# reflect instantly without rebuilding the image.
#
# Do NOT use this for production. Build a separate production image
# that uses `node server.js` with a compiled/optimised bundle.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine

# dumb-init handles OS signals (SIGTERM/SIGINT) correctly inside containers.
# Without it, Node.js runs as PID 1 and doesn't receive shutdown signals properly.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files first — Docker caches this layer.
# As long as package.json doesn't change, npm install won't re-run on rebuild.
COPY package*.json ./

# Install all deps including devDependencies (we need nodemon for hot reload)
RUN npm install

# Copy source — this layer is overridden at runtime by the docker-compose volume mount
COPY . .

EXPOSE 5001

# dumb-init as entrypoint so signals are forwarded correctly to node
ENTRYPOINT ["dumb-init", "--"]

# Run in dev mode (nodemon watches for file changes and restarts automatically)
CMD ["npm", "run", "dev"]
