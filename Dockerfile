# RivalWatch - single-process container (API + UI + scheduler), SQLite on a mounted volume.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# su-exec: drop from root to the app user after fixing volume ownership (see docker-entrypoint.sh).
# chromium + fonts: the headless renderer for JavaScript-only sites. Installed
# unconditionally so RENDER_ENABLED can be flipped without a rebuild; it costs
# image size, not memory, until a page actually needs rendering.
RUN apk add --no-cache su-exec chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto font-noto-cjk \
 && addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
COPY --chown=app:app public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
# Railway/Fly inject PORT; the app binds 0.0.0.0 in production.
ENV DATABASE_PATH=/data/rivalwatch.db
ENV RENDER_BROWSER_PATH=/usr/bin/chromium-browser
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
