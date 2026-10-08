# syntax=docker/dockerfile:1

# Base image, pinned by digest so a rebuild of the same commit starts from the
# same bits. Dependabot (.github/dependabot.yml) proposes digest bumps as PRs
# to `development`; nothing changes the base image silently. It is a literal
# FROM, not an ARG, because Dependabot does not update images named via ARG.
# Both stages below derive from it, so this is the only line to bump.
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS base

#############################
# Builder: compile the main app and the configure (admin) app
#############################

FROM base AS builder

WORKDIR /usr/src/app

ARG PUBLIC_URL_ARG=
ENV PUBLIC_URL=$PUBLIC_URL_ARG

# chart.js@4, chartjs-plugin-zoom@2 and react-chartjs-2@5 all agree on
# chart.js v4, so peer deps resolve cleanly without --force.
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY configure/package.json configure/package-lock.json ./configure/
RUN --mount=type=cache,target=/root/.npm cd configure && npm ci

COPY . .

# dist/ (theme CSS + fonts) is NOT built here: the deploy workflow runs
# `npm run build:themes` before the image build, and scripts/build.js exits
# non-zero when dist/ is missing from the build context.
RUN npm run build
RUN cd configure && rm -rf build/* && npm run build

#############################
# Runtime image
#############################

FROM base

# Set to "false" to skip Python/STAC services (smaller, faster builds). CI
# builds pass WITH_STAC=false; local full-mode docker compose defaults to true.
ARG WITH_STAC=true
ENV WITH_STAC=$WITH_STAC

# Without STAC there is no micromamba Python, so install the distro python3
# and make `python` resolve to it: the mission clone route shells out to
# `python private/api/create_mission.py` (stdlib only).
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    bzip2 \
    curl \
    $( [ "$WITH_STAC" = "true" ] || echo python3 python-is-python3 ) \
    && rm -rf /var/lib/apt/lists/*

ARG PUBLIC_URL_ARG=
ENV PUBLIC_URL=$PUBLIC_URL_ARG

# Use build arguments to detect target platform
ARG TARGETPLATFORM
ARG TARGETARCH

#############################
# Micromamba (for Python)
#############################

RUN if [ "$WITH_STAC" = "true" ]; then \
        mkdir -p /opt/micromamba/bin && \
        MICROMAMBA_URL="https://micro.mamba.pm/api/micromamba/linux-64/latest" && \
        if [ "${TARGETARCH}" = "arm64" ]; then \
            MICROMAMBA_URL="https://micro.mamba.pm/api/micromamba/linux-aarch64/latest"; \
        elif [ -z "${TARGETARCH}" ]; then \
            echo "TARGETARCH is empty, defaulting to amd64"; \
        fi && \
        echo "Downloading micromamba for ${TARGETARCH} from: ${MICROMAMBA_URL}" && \
        curl -Ls "${MICROMAMBA_URL}" | tar -C /opt/micromamba -xvj bin/micromamba && \
        MAMBA_ROOT_PREFIX="/opt/micromamba" /opt/micromamba/bin/micromamba shell init -s bash && \
        echo 'export PATH="/opt/micromamba/bin:$PATH"' >> /root/.bashrc && \
        echo 'export MAMBA_ROOT_PREFIX="/opt/micromamba"' >> /root/.bashrc; \
    else \
        echo "Skipping Python/STAC installation (WITH_STAC=false)"; \
    fi

#############################
# Python environment
#############################

WORKDIR /usr/src/app

# Copy only python env file first (cached unless this file changes)
COPY python-environment.yml ./
RUN if [ "$WITH_STAC" = "true" ]; then \
        MAMBA_ROOT_PREFIX=/opt/micromamba /opt/micromamba/bin/micromamba env create -y --name mmgis --file=python-environment.yml; \
    else \
        echo "Skipping Python environment creation (WITH_STAC=false)"; \
    fi

#############################
# MMGIS dependencies
#############################

# Full install, devDependencies included: the publish task runs from this
# same image and rebuilds the bundle with webpack (scripts/publish-static.js).
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci

#############################
# Source and build output
#############################

# Only what the server, init-db and the publish task read at runtime. The
# publish task's webpack build needs src/, configuration/, dist/, public/,
# tsconfig.json and the full node_modules above. auxiliary/ is kept (small)
# because the admin UI points operators at its scripts.
COPY tsconfig.json _docker-entrypoint.sh ./
COPY API ./API
COPY adjacent-servers ./adjacent-servers
COPY auxiliary ./auxiliary
COPY configuration ./configuration
COPY dist ./dist
# Read by the publish task (scripts/lib/cfn-template.js) for the dashboard's
# CloudFront Function body.
COPY infrastructure/cloudfront-function.js ./infrastructure/
COPY mission-profiles ./mission-profiles
COPY private ./private
COPY public ./public
COPY scripts ./scripts
COPY spice ./spice
COPY src ./src
COPY views ./views
COPY configure/package.json ./configure/
COPY configure/public ./configure/public

# The admin app is served from its build output only; configure/node_modules
# stays in the builder.
COPY --from=builder /usr/src/app/build ./build
COPY --from=builder /usr/src/app/configure/build ./configure/build

RUN chmod 755 _docker-entrypoint.sh

EXPOSE 8888
CMD [ "./_docker-entrypoint.sh" ]
