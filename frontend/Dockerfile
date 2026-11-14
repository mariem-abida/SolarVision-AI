FROM oven/bun:1.4.4 AS bun

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_API_BASE_URL=http://127.0.0.1:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    NITRO_PRESET=node_server
RUN bun run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8081
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 8081
CMD ["node", ".output/server/index.mjs"]
