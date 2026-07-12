# syntax=docker/dockerfile:1.7

FROM debian:trixie-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG TARGETARCH
ARG PYTHON_VERSION=3.12.13
ARG NODE_VERSION=22.16.0
ARG PNPM_VERSION=10.11.0
ARG JAVA_8_VERSION=temurin-8.0.492+9
ARG JAVA_11_VERSION=temurin-11.0.31+11
ARG JAVA_17_VERSION=temurin-17.0.19+10
ARG JAVA_25_VERSION=temurin-25.0.3+9.0.LTS
ARG MAVEN_VERSION=3.6.3
ARG DEFAULT_JAVA_VERSION=temurin-17.0.19+10
ARG CODEX_VERSION=0.142.0
ARG CC_CONNECT_VERSION=1.4.1
ARG RTK_VERSION=0.43.0
ARG DEBIAN_FRONTEND=noninteractive
ARG DEBIAN_SUITE=trixie
ARG DEBIAN_MIRROR=http://mirrors.aliyun.com/debian
ARG DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security
ARG PYPI_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG NPM_REGISTRY_URL=https://registry.npmmirror.com

ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    MISE_DATA_DIR=/opt/mise \
    MISE_CACHE_DIR=/opt/mise/cache \
    MISE_CONFIG_DIR=/opt/mise/config \
    MISE_TRUSTED_CONFIG_PATHS=/workspace \
    XDG_DATA_HOME=/root/.local/share \
    XDG_CACHE_HOME=/root/.cache \
    UV_CACHE_DIR=/root/.cache/uv \
    UV_LINK_MODE=copy \
    PIP_INDEX_URL=${PYPI_INDEX_URL} \
    UV_DEFAULT_INDEX=${PYPI_INDEX_URL} \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY_URL} \
    npm_config_registry=${NPM_REGISTRY_URL} \
    MAVEN_OPTS="-Dmaven.repo.local=/root/.m2/repository" \
    PATH="/root/.local/bin:/opt/mise/shims:/opt/mise/bin:${PATH}"

RUN case "${TARGETARCH:-amd64}" in amd64|arm64) ;; *) echo "Unsupported CI image target architecture: ${TARGETARCH}" >&2; exit 1 ;; esac

RUN printf '%s\n' \
      'Types: deb' \
      "URIs: ${DEBIAN_MIRROR}" \
      "Suites: ${DEBIAN_SUITE} ${DEBIAN_SUITE}-updates" \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      '' \
      'Types: deb' \
      "URIs: ${DEBIAN_SECURITY_MIRROR}" \
      "Suites: ${DEBIAN_SUITE}-security" \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      bash \
      bubblewrap \
      ca-certificates \
      curl \
      default-mysql-client \
      git \
      gzip \
      jq \
      make \
      openssh-client \
      procps \
      ripgrep \
      rsync \
      tar \
      tzdata \
      unzip \
      xz-utils \
      zip \
 && ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime \
 && echo "${TZ}" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://mise.run | sh \
 && curl -LsSf https://astral.sh/uv/install.sh | sh

RUN printf '%s\n' \
      '[global]' \
      "index-url = ${PIP_INDEX_URL}" \
      > /etc/pip.conf \
 && printf '%s\n' \
      "registry=${npm_config_registry}" \
      > /root/.npmrc

RUN mise settings set idiomatic_version_file_enable_tools '["python", "node"]'

RUN --mount=type=cache,target=/opt/mise/cache,sharing=locked \
    mise install python@${PYTHON_VERSION} \
 && mise use -g python@${PYTHON_VERSION}

RUN --mount=type=cache,target=/opt/mise/cache,sharing=locked \
    mise install node@${NODE_VERSION} \
 && mise use -g node@${NODE_VERSION}

RUN --mount=type=cache,target=/opt/mise/cache,sharing=locked \
    mise install pnpm@${PNPM_VERSION} \
 && mise use -g pnpm@${PNPM_VERSION}

RUN --mount=type=cache,target=/opt/mise/cache,sharing=locked \
    mise install \
      java@${JAVA_8_VERSION} \
      java@${JAVA_11_VERSION} \
      java@${JAVA_17_VERSION} \
      java@${JAVA_25_VERSION} \
 && mise use -g java@${DEFAULT_JAVA_VERSION}

RUN --mount=type=cache,target=/opt/mise/cache,sharing=locked \
    mise install maven@${MAVEN_VERSION} \
 && mise use -g maven@${MAVEN_VERSION}

RUN case "${TARGETARCH:-amd64}" in \
      amd64) rtk_asset="rtk-x86_64-unknown-linux-musl.tar.gz" ;; \
      arm64) rtk_asset="rtk-aarch64-unknown-linux-gnu.tar.gz" ;; \
      *) echo "Unsupported rtk target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && tmp_dir="$(mktemp -d)" \
 && curl -fsSL \
      -o "${tmp_dir}/${rtk_asset}" \
      "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${rtk_asset}" \
 && curl -fsSL \
      -o "${tmp_dir}/checksums.txt" \
      "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/checksums.txt" \
 && grep "  ${rtk_asset}$" "${tmp_dir}/checksums.txt" > "${tmp_dir}/rtk.sha256" \
 && (cd "${tmp_dir}" && sha256sum -c rtk.sha256) \
 && tar -xzf "${tmp_dir}/${rtk_asset}" -C "${tmp_dir}" \
 && install -m 0755 "${tmp_dir}/rtk" /usr/local/bin/rtk \
 && rm -rf "${tmp_dir}" \
 && rtk --version

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    mkdir -p \
      /workspace \
 && npm install -g @openai/codex@${CODEX_VERSION} cc-connect@${CC_CONNECT_VERSION} \
 && mise reshim node \
 && printf '%s\n' \
      'export PATH="/root/.local/bin:/opt/mise/shims:/opt/mise/bin:${PATH}"' \
      'export MISE_DATA_DIR="/opt/mise"' \
      'export MISE_CACHE_DIR="/opt/mise/cache"' \
      'export MISE_CONFIG_DIR="/opt/mise/config"' \
      'export MISE_TRUSTED_CONFIG_PATHS="/workspace"' \
      'export XDG_DATA_HOME="/root/.local/share"' \
      'export XDG_CACHE_HOME="/root/.cache"' \
      'export UV_CACHE_DIR="/root/.cache/uv"' \
      'export UV_LINK_MODE="copy"' \
      "export PIP_INDEX_URL=\"${PIP_INDEX_URL}\"" \
      "export UV_DEFAULT_INDEX=\"${UV_DEFAULT_INDEX}\"" \
      "export NPM_CONFIG_REGISTRY=\"${NPM_CONFIG_REGISTRY}\"" \
      "export npm_config_registry=\"${npm_config_registry}\"" \
      'export MAVEN_OPTS="-Dmaven.repo.local=/root/.m2/repository"' \
      > /etc/profile.d/ci-all-in-one.sh \
 && chmod -R 0777 /workspace

WORKDIR /workspace

CMD ["bash"]
