# GitLab CI all-in-one image

Linux amd64/arm64 CI image based on Debian trixie with `mise` managed toolchains:

- Python `3.12.13`
- Node.js `22.16.0`
- pnpm `10.11.0`
- Java `temurin-8.0.492+9`, `temurin-11.0.31+11`, `temurin-17.0.19+10`, `temurin-25.0.3+9.0.LTS`
- Maven `3.6.3`
- uv installed by the official installer
- Codex CLI `0.142.0`
- cc-connect CLI `1.4.1`
- rtk CLI `0.43.0`
- MySQL client CLI
- Common CI CLIs: Git, curl, jq, OpenSSH client, ripgrep, make, rsync, procps,
  tar/gzip/unzip/zip/xz
- Default dependency mirrors for pip/uv and npm/pnpm

Codex and cc-connect are installed from npm with fixed Docker build args.
rtk is installed from the pinned GitHub release binary for the target Linux
architecture and is verified against the release `checksums.txt` before being copied to
`/usr/local/bin/rtk`.

The Dockerfile keeps the large language toolchains in separate build layers.
Python, Node.js, pnpm, Java, and Maven each have their own `mise install` layer,
so changing one version does not force Docker to rebuild every other toolchain
layer. BuildKit cache mounts also persist mise downloads under `/opt/mise/cache`
and npm package downloads under `/root/.npm` across builds when the builder
cache is available.

## Build

```bash
ci-all-in-one/build.sh
```

The default image tag uses the build time in `YYYYMMDDHHMM` format, for example
`ci-all-in-one:202606091306`.

The local helper builds `linux/amd64` by default. Override `PLATFORMS` for
Apple Silicon/macOS Docker hosts or for multi-architecture publishing:

```bash
PLATFORMS=linux/arm64 ci-all-in-one/build.sh ci-all-in-one:202606091306
PLATFORMS=linux/amd64,linux/arm64 ci-all-in-one/build.sh ci-all-in-one:202606091306
```

To override the generated tag:

```bash
ci-all-in-one/build.sh ci-all-in-one:202606091306
```

The build script labels each image with the Dockerfile SHA-256 and skips the
build when a local `ci-all-in-one` image already has the same Dockerfile digest.
Force a rebuild when needed:

```bash
FORCE_BUILD=1 ci-all-in-one/build.sh
```

The default dependency mirrors are suitable for mainland China networks:

| Tooling | Default mirror | Docker build arg |
| --- | --- | --- |
| pip / uv | `https://mirrors.aliyun.com/pypi/simple/` | `PYPI_INDEX_URL` |
| npm / pnpm | `https://registry.npmmirror.com` | `NPM_REGISTRY_URL` |

Override them when building for a private registry or another network:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg PYPI_INDEX_URL=https://pypi.example.com/simple \
  --build-arg NPM_REGISTRY_URL=https://npm.example.com \
  -t ci-all-in-one:202606091306 \
  ci-all-in-one
```

The image persists these values through both environment variables and standard
tool config files:

```bash
PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
UV_DEFAULT_INDEX="https://mirrors.aliyun.com/pypi/simple/"
NPM_CONFIG_REGISTRY="https://registry.npmmirror.com"
npm_config_registry="https://registry.npmmirror.com"
/etc/pip.conf
/root/.npmrc
```

## Cache mounts in Docker-in-Docker

The image uses each tool's default Linux cache location for the current user. In
the default root user container, Maven uses `/root/.m2/repository`, pnpm uses
`/root/.local/share/pnpm/store`, and uv uses `/root/.cache/uv`.
These paths are also explicitly pinned to the same default values in the image:

```bash
MAVEN_OPTS="-Dmaven.repo.local=/root/.m2/repository"
XDG_DATA_HOME="/root/.local/share"
XDG_CACHE_HOME="/root/.cache"
UV_CACHE_DIR="/root/.cache/uv"
```

pnpm derives its default store from `XDG_DATA_HOME` and its separate metadata
cache from `XDG_CACHE_HOME`. uv uses the dedicated `UV_CACHE_DIR`. Maven does
not provide a dedicated local-repository environment variable; the image uses
the documented `MAVEN_OPTS` mechanism to pass the `maven.repo.local` system
property.

## GitHub Actions self-hosted runner build cache

The `build-cc-connect-image` workflow uses a local BuildKit cache under:

```text
/_work/_buildx-cache/cc-connect
```

For the self-hosted runner container, this path must be on a persistent volume.
With this runner mount:

```yaml
- /volume1/docker/devops/data/github-runner/work:/_work
```

the cache persists on the NAS host at:

```text
/volume1/docker/devops/data/github-runner/work/_buildx-cache/cc-connect
```

This cache is separate from runtime dependency caches such as
`/root/.m2/repository`. The workflow's `type=local` BuildKit cache is imported
and exported by the GitHub runner process, so the path is resolved inside the
runner container and backed by the `/_work` volume above. The Dockerfile's
`RUN --mount=type=cache` entries for `/opt/mise/cache` and `/root/.npm` are
included in that BuildKit cache when exported with `mode=max`.

When GitLab CI runs with Docker-in-Docker, remember that bind mount source paths
are resolved on the filesystem where the Docker daemon runs. If the daemon runs
inside the `gitlab-runner` container, mount the physical host cache directory into
the `gitlab-runner` container first, then let GitLab Runner map that runner-side
path into the actual CI job container.

Recommended path mapping:

| Purpose | Physical host path | `gitlab-runner` container path | CI job container path |
| --- | --- | --- | --- |
| Maven local repository and optional `settings.xml` | `/opt/gitlab-runner-cache/maven` | `/opt/gitlab-runner-cache/maven` | `/root/.m2` |
| pnpm store | `/opt/gitlab-runner-cache/pnpm-store` | `/opt/gitlab-runner-cache/pnpm-store` | `/root/.local/share/pnpm/store` |
| uv cache | `/opt/gitlab-runner-cache/uv` | `/opt/gitlab-runner-cache/uv` | `/root/.cache/uv` |

With this mapping, the effective cache directories inside the CI job container are:

```text
/root/.m2/repository
/root/.local/share/pnpm/store
/root/.cache/uv
```

Example host-to-runner-container mounts:

```bash
docker run -d --name gitlab-runner --restart always \
  --privileged \
  -v /srv/gitlab-runner/config:/etc/gitlab-runner \
  -v /opt/gitlab-runner-cache/maven:/opt/gitlab-runner-cache/maven \
  -v /opt/gitlab-runner-cache/pnpm-store:/opt/gitlab-runner-cache/pnpm-store \
  -v /opt/gitlab-runner-cache/uv:/opt/gitlab-runner-cache/uv \
  gitlab/gitlab-runner:latest
```

Example runner-to-CI-job-container mapping in `config.toml`:

```toml
[runners.docker]
  volumes = [
    "/opt/gitlab-runner-cache/maven:/root/.m2:rw",
    "/opt/gitlab-runner-cache/pnpm-store:/root/.local/share/pnpm/store:rw",
    "/opt/gitlab-runner-cache/uv:/root/.cache/uv:rw"
  ]
```

Do not map Maven to `/cache/maven` for this image unless you also override
Maven's local repository path. The default behavior is to use the job user's
`~/.m2`; for the default root user, that is `/root/.m2`.

For pnpm, sharing the store is the important part. The separate pnpm cache lives
at `/root/.cache/pnpm` by default and mainly contains package metadata and dlx
data; it does not need to be shared when `/root/.local/share/pnpm/store` is
already shared. Add a separate `/root/.cache/pnpm` volume only if metadata
resolution or frequent `pnpm dlx` calls become a measured bottleneck.

## Java switching

Default Java is `temurin-17.0.19+10`.

Use a specific JDK for one command:

```bash
mise x java@temurin-8.0.492+9 -- mvn test
mise x java@temurin-11.0.31+11 -- mvn test
mise x java@temurin-17.0.19+10 -- mvn test
mise x java@temurin-25.0.3+9.0.LTS -- mvn test
```

Or switch the job default:

```bash
mise use -g java@temurin-8.0.492+9
java -version
```

Java 8 is pinned to Adoptium Temurin 8u492 b09 instead of the moving
`temurin-8` major-version alias.

## GitLab CI example

```yaml
image: registry.example.com/devops/ci-all-in-one:py312-node22-java8-11-17-25-mvn363-codex

before_script:
  - python --version
  - uv --version
  - node --version
  - pnpm --version
  - codex --version
  - cc-connect --version
  - rtk --version
  - mysql --version
  - rg --version
  - java -version
  - mvn -version
```

## GitLab MR review example

The image already includes Codex CLI, so the job does not need `npm i -g @openai/codex`.

```yaml
stages:
  - review

codex_review:
  stage: review
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  variables:
    GIT_DEPTH: "0"
  script:
    - git diff --unified=80 "$CI_MERGE_REQUEST_DIFF_BASE_SHA"...HEAD > mr.diff
    - |
      codex exec --ephemeral \
        "你是资深代码 reviewer。请只审查下面 MR diff 中引入的变更。
        输出中文 Markdown。
        要求：
        1. 只报告明确的 bug、回归风险、安全问题、并发问题、数据一致性问题、缺失关键测试。
        2. 不要提纯风格、命名、格式化问题。
        3. 每个问题包含：严重级别 P0/P1/P2/P3、文件路径、行号或代码片段、原因、建议修复。
        4. 如果没有发现明确问题，直接说未发现阻塞性问题，并列出残余风险。
        " < mr.diff > codex-review.md
    - |
      BODY="$(cat codex-review.md)"
      jq -n --arg body "$BODY" '{body: $body}' > payload.json
      curl --request POST \
        --header "PRIVATE-TOKEN: $GITLAB_REVIEW_BOT_TOKEN" \
        --header "Content-Type: application/json" \
        --data @payload.json \
        "$CI_API_V4_URL/projects/$CI_MERGE_REQUEST_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/discussions"
```
