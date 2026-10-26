FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY notes ./notes
COPY review ./review
COPY glossary ./glossary
COPY system ./system
COPY showcase ./showcase
COPY topic ./topic
COPY src ./src
COPY public ./public
COPY scripts/topic-content.mjs scripts/topic-blocks.mjs scripts/patent-contract.mjs scripts/patent-research.mjs scripts/source-citations.mjs ./scripts/
RUN npm run build

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
WORKDIR /app
RUN addgroup -g 1001 learning-socket && adduser -D -u 1001 -G learning-socket learning && mkdir /asset-cache && chown learning:learning-socket /asset-cache
COPY --from=build /app/package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/web.mjs server/assets.mjs server/content-query.mjs server/content-cache.mjs server/stage-timing.mjs server/http-response.mjs server/database.mjs server/records.mjs server/main-module.mjs ./server/
COPY server/schema ./server/schema
COPY scripts/settings.mjs scripts/r2.mjs scripts/notes-reading.mjs scripts/topic-index.mjs scripts/topic-content.mjs scripts/topic-blocks.mjs scripts/patent-contract.mjs scripts/patent-research.mjs scripts/source-citations.mjs scripts/glossary.mjs scripts/site-catalog.mjs ./scripts/
COPY src/ui ./src/ui
COPY src/contracts ./src/contracts
USER learning
EXPOSE 8080
CMD ["node", "server/web.mjs"]
