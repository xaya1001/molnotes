FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
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
