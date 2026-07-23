FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/cli/package.json packages/cli/package.json
RUN npm ci --workspace=open-ocr-cli --include-workspace-root=false
COPY . .
RUN npm run cli:build

FROM node:26-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS runtime
LABEL org.opencontainers.image.source="https://github.com/cyanxxy/gemini-ocr"
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
