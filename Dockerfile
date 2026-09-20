# The game server, as one container.
#
# Two stages. The builder needs TypeScript, Vite and every dev dependency; the
# runtime needs Node, one production dependency (zod) and the built output. The
# split keeps the shipped image to what actually runs, and — more usefully —
# means a broken build fails here rather than at boot on the host.
#
# WHAT MUST BE IN THE IMAGE, and why each one:
#   dist/         the compiled server
#   overlay/      the built overlay, loadout and admin pages
#   web/public/   the art the server serves at runtime (see PUBLIC_DIR in
#                 src/server/index.ts — it wins over the copy inside overlay/)
#   content/      dungeons, gear, raids, balance. Loaded and validated at boot.
#
# NOT in the image: art/ (124MB of source sheets and pre-erase originals, all
# of it an input to the slicers and none of it read at runtime) and data/,
# which is a volume — baking a roster into an image would restore a stale one
# on every deploy.

# ---- build -----------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Dependencies first, so a source-only change does not re-download them.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/package.json web/package-lock.json* ./web/
RUN npm install --prefix web --no-audit --no-fund

COPY . .

# The overlay build writes into overlay/; the server build writes into dist/.
RUN npm run build:web && npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only — no TypeScript, no Vite, no tsx.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/overlay ./overlay
COPY --from=build /app/web/public ./web/public
COPY content ./content

# Where the roster lives. Mount a volume here, or point DATA_DIR elsewhere.
#
# CREATED AND CHOWNED BEFORE `VOLUME`, and that order is the whole point. A
# `VOLUME` declaration makes the mountpoint owned by root, the process runs as
# `node`, and every save then fails with EACCES — which the server logs and
# carries on from, so the game runs a whole stream cheerfully discarding
# everyone's progress. A fresh named volume inherits the ownership of the image
# directory underneath it, so chowning here is what makes it writable.
#
# (A BIND mount does not inherit it — it keeps the host's ownership. If you
# bind-mount instead, chown the host directory to uid 1000 yourself.)
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Must match fly.toml's internal_port and whatever the host expects.
ENV PORT=8080
EXPOSE 8080

# Not root. The process only ever writes to /data and content/, and nothing it
# does needs more than that.
USER node

CMD ["node", "dist/server/index.js"]
