FROM oven/bun:1-debian AS runtime-base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        coreutils \
        findutils \
        git \
        python3 \
        ripgrep \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-base AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/file-snapshot-cache/package.json ./packages/file-snapshot-cache/package.json
COPY packages/neuro-book-manager/package.json ./packages/neuro-book-manager/package.json
COPY packages/owned-process/package.json ./packages/owned-process/package.json
COPY packages/neuro-book-test-support/package.json ./packages/neuro-book-test-support/package.json
COPY packages/neuro-book-contracts/package.json ./packages/neuro-book-contracts/package.json
COPY packages/neuro-book/package.json ./packages/neuro-book/package.json
COPY packages/nb-history/package.json ./packages/nb-history/package.json
COPY packages/nb-workflow/package.json ./packages/nb-workflow/package.json
COPY packages/nb-memory/package.json ./packages/nb-memory/package.json
COPY packages/nb-ui/package.json ./packages/nb-ui/package.json
COPY packages/neuro-agent-harness/package.json ./packages/neuro-agent-harness/package.json
COPY packages/neuro-agent-harness/tsconfig.json packages/neuro-agent-harness/tsconfig.build.json ./packages/neuro-agent-harness/
COPY packages/neuro-agent-harness/src ./packages/neuro-agent-harness/src
COPY packages/llmlint/package.json ./packages/llmlint/package.json
COPY patches ./patches
RUN cp bun.lock /tmp/bun.lock \
    && bun install --frozen-lockfile --linker hoisted \
    && cmp bun.lock /tmp/bun.lock

FROM runtime-base AS build
WORKDIR /app

ARG NEURO_BOOK_SOURCE_REVISION
ENV DATABASE_KIND=sqlite
ENV DATABASE_URL=file:./workspace/.nbook/neuro-book.sqlite
ENV NEURO_BOOK_SOURCE_REVISION=${NEURO_BOOK_SOURCE_REVISION}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run --cwd packages/neuro-agent-harness build
RUN NEURO_BOOK_OUTPUT_DIR=/app/.output bun run --cwd packages/neuro-book nuxt:build
RUN test -f .output/runtime-image.json && test -f .output/runtime-image.ready

FROM runtime-base AS runner
WORKDIR /app

ARG NEURO_BOOK_SOURCE_REVISION
LABEL org.opencontainers.image.revision=${NEURO_BOOK_SOURCE_REVISION}

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts/deploy/docker-product-entrypoint.sh ./docker-product-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["sh", "./docker-product-entrypoint.sh"]
