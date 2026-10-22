# Donwinne web app: build with Node, serve the static files with nginx.
#   docker build -t donwinne .
#   docker run --rm -p 8080:80 donwinne     # then open http://localhost:8080

FROM node:22-alpine AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    CI=true
RUN npm install -g pnpm@10.28.0

# Install dependencies first so they are cached between source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/io/package.json packages/io/
COPY packages/sim/package.json packages/sim/
COPY packages/ft/package.json packages/ft/
COPY packages/analysis/package.json packages/analysis/
COPY packages/apn/package.json packages/apn/
COPY packages/editor/package.json packages/editor/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
# The desktop shell is not needed for the web image.
RUN pnpm install --frozen-lockfile --filter "@pns/web" --filter "donwinne"

COPY tsconfig.base.json tsconfig.json vitest.config.ts ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm test && pnpm --filter @pns/web build

FROM nginx:1.30-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
