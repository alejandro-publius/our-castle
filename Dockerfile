# The keyless example demo in a container, for a visitor without Node.js 22.16+.
#
#   docker build -t our-castle .
#   docker run --rm -p 127.0.0.1:8080:8080 our-castle                  # the five-family village fund
#   docker run --rm -p 127.0.0.1:8080:8080 our-castle --family-trip    # or another story, or no flag for a blank house
#
# Then open http://localhost:8080. It is the same `npm run demo`: an in-memory household, invented data and simulated
# payments. It reads no key, no .env and no saved record, and contacts no provider. Nothing here deploys anything.
# Node 24 is one of the three versions the hosted checks run; on it the built-in SQLite loads without a warning.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Only what the demo runs with: the browser-test and build tools are development dependencies and stay out.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

COPY . .

# An unprivileged user; the demo writes nothing to disk.
USER node
EXPOSE 8080

# The container's own loopback address is not reachable from the computer running it, so the demo listens on all of the
# container's interfaces. Publishing with `-p 127.0.0.1:8080:8080` keeps it on that computer.
ENTRYPOINT ["node", "scripts/demo.mjs", "--host=0.0.0.0", "--port=8080"]
CMD ["--village-fund"]
