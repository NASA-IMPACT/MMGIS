FROM node:20-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    bzip2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

ARG PUBLIC_URL_ARG=
ENV PUBLIC_URL=$PUBLIC_URL_ARG

# Use build arguments to detect target platform
ARG TARGETPLATFORM
ARG TARGETARCH

# Set to "false" to skip Python/STAC services (faster builds)
ARG WITH_STAC=true
ENV WITH_STAC=$WITH_STAC

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
        . /root/.bashrc && micromamba env create -y --name mmgis --file=python-environment.yml; \
    else \
        echo "Skipping Python environment creation (WITH_STAC=false)"; \
    fi

#############################
# MMGIS Dependencies
#############################

# Copy only package files first (cached unless these change)
COPY package*.json ./
# --force is required: react-chartjs-2@5 wants chart.js@^4.1.1, but
# chartjs-plugin-zoom@1.2.1 pins ^3.2.0. Don't use --legacy-peer-deps; in this
# tree it silently drops @deck.gl/extensions and @deck.gl/mesh-layers.
RUN npm install --force

#############################
# MMGIS Configure Dependencies
#############################

# Copy configure package files separately
COPY configure/package*.json ./configure/
RUN cd configure && npm install

#############################
# Source Code & Build
#############################

# NOW copy all source code (changes here won't invalidate npm install cache above)
COPY . .

# Build main app
RUN npm run build

# Build configure
RUN cd configure && rm -rf build/* && npm run build

RUN chmod 755 _docker-entrypoint.sh

EXPOSE 8888
CMD [ "./_docker-entrypoint.sh" ]
