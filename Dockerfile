FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/cli/package.json packages/cli/package.json
RUN npm ci
COPY . .
RUN mkdir -p /tmp/package \
    && npm run cli:build \
    && npm pack ./packages/cli --pack-destination /tmp/package

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/cyanxxy/gemini-ocr"
LABEL org.opencontainers.image.description="Provider-neutral multimodal OCR CLI"
ENV NODE_ENV=production
COPY --from=build /tmp/package/open-ocr-cli-*.tgz /tmp/open-ocr-cli.tgz
RUN npm install --global /tmp/open-ocr-cli.tgz \
    && npm cache clean --force \
    && rm /tmp/open-ocr-cli.tgz \
    && mkdir -p /work \
    && chown node:node /work
WORKDIR /work
USER node
ENTRYPOINT ["open-ocr-cli"]
CMD ["--help"]
