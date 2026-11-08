ARG NODE_IMAGE=node:24.19.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
RUN npm install --global npm@11.9.0 --ignore-scripts --no-audit --no-fund \
    && npm ci --ignore-scripts --no-audit --no-fund \
    && npm run build

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/engshort/fortnox-mcp" \
      org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
RUN mkdir -p /data && chown 10001:10001 /data && chmod 0700 /data
COPY --from=build /app/dist/product-node.js /app/dist/product-node.js
COPY --from=build /app/apps/worker/migrations /app/migrations
COPY deploy/docker/healthcheck.mjs deploy/docker/initialize.mjs /app/
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data PRODUCT_MIGRATIONS_DIR=/app/migrations
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "/app/dist/product-node.js"]
