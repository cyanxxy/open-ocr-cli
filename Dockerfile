FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/cli/package.json packages/cli/package.json
RUN npm ci --workspace=open-ocr-cli --include-workspace-root=false
COPY . .
RUN npm run cli:build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime
LABEL org.opencontainers.image.source="https://github.com/cyanxxy/open-ocr-cli"
LABEL org.opencontainers.image.description="Provider-neutral multimodal OCR CLI"
ENV NODE_ENV=production
WORKDIR /opt/open-ocr
COPY package.json package-lock.json ./
COPY --from=build /src/packages/cli packages/cli
RUN npm ci --omit=dev --workspace=open-ocr-cli --include-workspace-root=false \
    && ln -s /opt/open-ocr/node_modules/.bin/open-ocr-cli /usr/local/bin/open-ocr-cli \
    && ln -s /opt/open-ocr/node_modules/.bin/gemini-ocr /usr/local/bin/gemini-ocr \
    && npm cache clean --force \
    && mkdir -p /work \
    && chown node:node /work
WORKDIR /work
USER node
ENTRYPOINT ["open-ocr-cli"]
CMD ["--help"]
