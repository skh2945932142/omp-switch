# OMP Switch headless CLI.
#
# Scope: this image contains the JSON CLI only. It reads and writes Oh My Pi config files
# (models.yml / config.yml) and creates snapshots. It deliberately does NOT contain the desktop GUI
# or the credential vault: API keys are sealed with Electron safeStorage (DPAPI on Windows) and can
# only be opened by the desktop app or the native secret bridge on the machine that stored them.
#
# Build:  docker build -t omp-switch-cli .
# Use:    docker run --rm -v "$HOME/.omp:/home/node/.omp" omp-switch-cli validate --profile default

FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
# Copy manifests first so dependency installation caches independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json vite.cli.config.ts ./
COPY packages/core packages/core
COPY packages/cli packages/cli
RUN pnpm build:cli

FROM node:24-alpine AS runtime
# The bundle inlines every dependency, so the runtime layer needs nothing but Node itself.
COPY --from=build /src/packages/cli/dist/main.js /usr/local/lib/omp-switch/main.js
RUN printf '#!/bin/sh\nexec node /usr/local/lib/omp-switch/main.js "$@"\n' > /usr/local/bin/omp-switch-cli \
  && chmod 0755 /usr/local/bin/omp-switch-cli

# Runs unprivileged: this tool edits user-owned config and never needs root.
USER node
WORKDIR /home/node
ENV OMP_SWITCH_DATA_DIR=/home/node/.local/share/omp-switch

ENTRYPOINT ["omp-switch-cli"]
CMD ["--help"]
