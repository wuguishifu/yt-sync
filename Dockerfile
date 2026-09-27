FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DOWNLOAD_DIR=/downloads \
    YTDLP_PATH=/opt/bin/yt-dlp \
    FFMPEG_PATH=/opt/bin/ffmpeg
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
RUN mkdir -p /data /downloads && chown node:node /data /downloads
USER node
EXPOSE 3000
VOLUME ["/data", "/downloads"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
