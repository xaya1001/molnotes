FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
RUN addgroup -g 1001 learning-socket && adduser -D -u 1001 -G learning-socket learning && mkdir /data && chown learning:learning-socket /data
COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY dist ./dist
COPY server/web ./server/web
COPY shared ./shared
COPY src/ui ./src/ui
COPY src/contracts ./src/contracts
ENV MOLNOTES_RECORDS_FILE=/data/records.sqlite
USER learning
EXPOSE 8080
CMD ["node", "server/web/web.ts"]
