FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS runtime-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM dependencies AS web-build
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_AMAP_JS_KEY
ARG NEXT_PUBLIC_AMAP_SECURITY_CODE
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AMAP_JS_KEY=$NEXT_PUBLIC_AMAP_JS_KEY
ENV NEXT_PUBLIC_AMAP_SECURITY_CODE=$NEXT_PUBLIC_AMAP_SECURITY_CODE
COPY . .
# The legacy Cloudflare Worker API remains available for Sites deployments,
# but the single-server image sends /api to the Express service behind Nginx.
RUN rm -rf app/api && npm run build

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=web-build /app/package.json /app/package-lock.json ./
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=web-build /app/dist ./dist
EXPOSE 3000
CMD ["npm","start","--","--hostname","0.0.0.0","--port","3000"]

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY server ./server
COPY app/api/deepseek.ts ./app/api/deepseek.ts
EXPOSE 8000
CMD ["node","--import","tsx","server/index.ts"]
