# syntax=docker/dockerfile:1
FROM docker.io/oven/bun:1.4.4 AS build
WORKDIR /build
COPY package.json bun.lock bunfig.toml ./
COPY cli/package.json ./cli/
COPY shared/package.json ./shared/
COPY hub/package.json ./hub/
COPY web/package.json ./web/
COPY website/package.json ./website/
COPY docs/package.json ./docs/
COPY relay/package.json ./relay/
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY . .
RUN bun run build:web \
    && bun run --cwd hub generate:embedded-web-assets \
    && bun build --compile --target=bun hub/src/index.ts --outfile /build/hapi-hub

FROM docker.io/library/node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/matiziompl/hapi-fork"
WORKDIR /app
COPY --from=build --chown=1000:1000 /build/hapi-hub /usr/local/bin/hapi-hub
RUN mkdir -p /home/node/.hapi && chown -R node:node /home/node/.hapi
USER node
ENV HOME=/home/node
EXPOSE 3006
CMD ["hapi-hub", "--no-relay"]
