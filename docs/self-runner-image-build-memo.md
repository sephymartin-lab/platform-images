# Self-Hosted Runner Image Build Memo

本文记录在自建 GitHub Actions runner 上执行 Docker 镜像构建时需要注意的缓存和路径问题。后续新增镜像构建 workflow 时，优先按这里的约束设计。

## Runner 形态

当前 runner 运行在容器中，并挂载宿主机 Docker socket：

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - /volume1/docker/devops/data/github-runner/work:/_work
```

这种模式下，job 里的 `docker` 命令不是在 runner 容器里启动嵌套 Docker daemon，而是在操作 NAS 宿主机的 Docker daemon。

因此需要区分三类路径：

- GitHub job / runner 容器内路径，例如 `/_work`。
- NAS 宿主机路径，例如 `/volume1/docker/devops/data/github-runner/work`。
- Dockerfile 构建容器内路径，例如 `RUN --mount=type=cache,target=/opt/mise/cache` 里的 `/opt/mise/cache`。

这三类路径不能混用。

## BuildKit Cache Mount

Dockerfile 中的 BuildKit cache mount：

```dockerfile
RUN --mount=type=cache,target=/opt/mise/cache,sharing=locked ...
RUN --mount=type=cache,target=/root/.npm,sharing=locked ...
```

其中 `target` 是构建容器内路径，不是 runner 容器路径，也不是 NAS 宿主机路径。

如果 workflow 只使用 `cache-to: type=gha`，Docker layer cache 可以被保存，但 `RUN --mount=type=cache` 的内容不能按普通目录挂载逻辑来理解。对自建 runner 来说，更可控的方式是使用本地 BuildKit cache。

## 推荐 Workflow 缓存方式

在自建 runner 的镜像构建 workflow 中，优先使用 `type=local`：

```yaml
env:
  BUILDX_CACHE_DIR: /_work/_buildx-cache/<image-name>

steps:
  - name: Prepare local BuildKit cache
    run: |
      mkdir -p "${BUILDX_CACHE_DIR}"

  - name: Build and push image
    uses: docker/build-push-action@v6
    with:
      cache-from: type=local,src=${{ env.BUILDX_CACHE_DIR }}
      cache-to: type=local,dest=${{ env.BUILDX_CACHE_DIR }}-new,mode=max

  - name: Rotate local BuildKit cache
    if: always()
    run: |
      if [ -d "${BUILDX_CACHE_DIR}-new" ]; then
        rm -rf "${BUILDX_CACHE_DIR}"
        mv "${BUILDX_CACHE_DIR}-new" "${BUILDX_CACHE_DIR}"
      fi
```

如果 runner compose 中有：

```yaml
- /volume1/docker/devops/data/github-runner/work:/_work
```

那么 `/_work/_buildx-cache/<image-name>` 会持久化到 NAS 宿主机：

```text
/volume1/docker/devops/data/github-runner/work/_buildx-cache/<image-name>
```

## 并发控制

同一个本地 BuildKit cache 目录不能被多个 workflow run 同时轮转。每个镜像构建 workflow 应配置独立的 `concurrency`：

```yaml
concurrency:
  group: build-<image-name>-image
  cancel-in-progress: false
```

如果同一个 workflow 会构建多个镜像，每个镜像应使用不同的 `BUILDX_CACHE_DIR`。

## Runtime Cache 与 Build Cache 的区别

runner compose 中类似下面的挂载：

```yaml
- /volume1/docker/devops/data/maven/.m2/repository:/root/.m2/repository
```

只对 runner 容器内直接执行的 Maven 命令有效，例如 job step 里直接运行 `mvn test`。

它不会自动影响 `docker buildx build` 过程中的 Dockerfile 构建容器。Dockerfile 里的 Maven、npm、mise、uv 等缓存，应通过 BuildKit cache 或显式 Dockerfile 设计来处理。

## Dockerfile 设计建议

镜像 Dockerfile 中应尽量做到：

- 大体积工具链使用固定版本，避免基础工具版本漂移导致不可复现构建。
- 将 Python、Node.js、pnpm、Java、Maven 等工具链拆成独立 `RUN` 层，减少单个版本变化造成的大面积缓存失效。
- 对下载缓存使用 BuildKit cache mount，例如 `/opt/mise/cache`、`/root/.npm`、`/root/.cache/uv`。
- 对 apt 包不要轻易 pin 到具体 Debian patch 包，除非有强可复现要求；否则会增加安全更新维护成本。
- `FROM` 是否 pin digest 需要单独权衡：pin digest 可提升可复现性，但会降低自动获得基础镜像安全更新的便利性。

## 检查清单

新增自建 runner 镜像构建 workflow 前，检查：

- workflow 是否运行在预期的 self-hosted runner label 上。
- `/_work` 是否映射到 NAS 持久化目录。
- `BUILDX_CACHE_DIR` 是否位于 `/_work` 下。
- 每个镜像是否有独立的 BuildKit cache 目录。
- workflow 是否配置了 `concurrency`，避免同时写同一个 cache 目录。
- `docker/build-push-action` 是否使用 `cache-from: type=local` 和 `cache-to: type=local,mode=max`。
- Dockerfile 是否使用 BuildKit syntax 声明，例如 `# syntax=docker/dockerfile:1.7`。
- Dockerfile 中的大体积工具链是否拆层并固定版本。
- runner compose 中的 `/root/.m2`、`/opt/hostedtoolcache` 等挂载是否被误认为 Dockerfile 构建缓存。
