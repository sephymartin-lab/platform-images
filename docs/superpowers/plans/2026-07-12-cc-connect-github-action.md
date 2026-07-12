# cc-connect GitHub Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that builds `cc-connect/Dockerfile` and pushes the image to `docker-registry.sephy.top/cc-connect` after a pull request is merged.

**Architecture:** A single GitHub Actions workflow handles the build and publish lifecycle. It triggers on merged pull request close events and manual `workflow_dispatch` runs, conditionally logs in when both registry credential secrets are configured, otherwise pushes anonymously, and pushes `latest`, `sha-<short-sha>`, plus `pr-<number>` for PR runs.

**Tech Stack:** GitHub Actions, Docker Buildx, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`, YAML.

## Global Constraints

- The image repository is fixed to `docker-registry.sephy.top/cc-connect`.
- The workflow must not run on direct pushes to `main`.
- The workflow runs automatically after a pull request is merged and can also be triggered manually from GitHub Actions.
- The Dockerfile build context is `cc-connect`.
- The Dockerfile supports only `linux/amd64`, so the workflow builds `linux/amd64` only.
- Registry credentials are optional. If both credential secrets are configured, run `docker/login-action`; if neither is configured, push anonymously.
- Required together when authentication is desired: `DOCKER_REGISTRY_USERNAME` and `DOCKER_REGISTRY_PASSWORD`.
- Do not modify `cc-connect/Dockerfile`.

---

## File Structure

- Create `.github/workflows/build-cc-connect-image.yml`: GitHub Actions workflow for PR-merge-triggered Docker image build and push.
- Read-only reference `cc-connect/Dockerfile`: existing Dockerfile used by the workflow.
- No changes to `cc-connect/build.sh`: local build helper remains independent from CI publishing.

## Task 1: Add PR-Merge Docker Image Publishing Workflow

**Files:**
- Create: `.github/workflows/build-cc-connect-image.yml`
- Reference: `cc-connect/Dockerfile`
- Reference: `docs/superpowers/specs/2026-07-12-cc-connect-github-action-design.md`

**Interfaces:**
- Consumes: GitHub event `pull_request.closed`, field `github.event.pull_request.merged`, optional repository secrets `DOCKER_REGISTRY_USERNAME` and `DOCKER_REGISTRY_PASSWORD`.
- Produces: pushed Docker image tags `docker-registry.sephy.top/cc-connect:latest`, `docker-registry.sephy.top/cc-connect:sha-<short-sha>`, and for PR runs `docker-registry.sephy.top/cc-connect:pr-<number>`.

- [ ] **Step 1: Create the workflow directory**

Run:

```bash
mkdir -p .github/workflows
```

Expected: directory `.github/workflows` exists.

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/build-cc-connect-image.yml` with this exact content:

```yaml
name: Build cc-connect image

on:
  workflow_dispatch:
  pull_request:
    types:
      - closed
    branches:
      - main

permissions:
  contents: read

env:
  REGISTRY: docker-registry.sephy.top
  IMAGE_NAME: docker-registry.sephy.top/cc-connect

jobs:
  build-and-push:
    name: Build and push image
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.pull_request.merged == true }}
    runs-on: ubuntu-latest
    env:
      DOCKER_REGISTRY_USERNAME: ${{ secrets.DOCKER_REGISTRY_USERNAME }}
      DOCKER_REGISTRY_PASSWORD: ${{ secrets.DOCKER_REGISTRY_PASSWORD }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Validate optional registry credentials
        if: ${{ (env.DOCKER_REGISTRY_USERNAME == '') != (env.DOCKER_REGISTRY_PASSWORD == '') }}
        run: |
          echo "DOCKER_REGISTRY_USERNAME and DOCKER_REGISTRY_PASSWORD must be configured together, or both left empty for anonymous push." >&2
          exit 1

      - name: Log in to registry
        if: ${{ env.DOCKER_REGISTRY_USERNAME != '' && env.DOCKER_REGISTRY_PASSWORD != '' }}
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ env.DOCKER_REGISTRY_USERNAME }}
          password: ${{ env.DOCKER_REGISTRY_PASSWORD }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=raw,value=pr-${{ github.event.pull_request.number }},enable=${{ github.event_name == 'pull_request' }}
            type=sha,prefix=sha-,format=short

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: cc-connect
          file: cc-connect/Dockerfile
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 3: Verify the trigger does not include direct pushes**

Run:

```bash
rg -n "^  push:|^on:|pull_request|merged|branches:" .github/workflows/build-cc-connect-image.yml
```

Expected output includes `pull_request`, `closed`, `branches`, `main`, and `github.event.pull_request.merged == true`. Expected output does not include `push:`.

- [ ] **Step 4: Verify the image target and build context**

Run:

```bash
rg -n "docker-registry\\.sephy\\.top/cc-connect|context: cc-connect|file: cc-connect/Dockerfile|platforms: linux/amd64|push: true" .github/workflows/build-cc-connect-image.yml
```

Expected output includes all five required values:

```text
docker-registry.sephy.top/cc-connect
context: cc-connect
file: cc-connect/Dockerfile
platforms: linux/amd64
push: true
```

- [ ] **Step 5: Verify the YAML parses**

Run:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/build-cc-connect-image.yml"); puts "yaml ok"'
```

Expected:

```text
yaml ok
```

- [ ] **Step 6: Verify the workflow file is staged cleanly**

Run:

```bash
git status --short
```

Expected output includes:

```text
?? .github/
```

or, after staging:

```text
A  .github/workflows/build-cc-connect-image.yml
```

- [ ] **Step 7: Commit the workflow**

Run:

```bash
git add .github/workflows/build-cc-connect-image.yml
git commit -m "ci: publish cc-connect image after PR merge"
```

Expected: commit succeeds and includes only `.github/workflows/build-cc-connect-image.yml` for this task.

## Manual Repository Setup

No registry secrets are required while `docker-registry.sephy.top` allows
anonymous push. To use authenticated push, configure both repository secrets:

```text
DOCKER_REGISTRY_USERNAME
DOCKER_REGISTRY_PASSWORD
```

If only one of these secrets is configured, the workflow fails before build/push
instead of silently falling back to anonymous push.

## End-to-End Validation

After the workflow file is merged through a pull request:

1. Confirm a GitHub Actions run starts on the merged PR close event.
2. Confirm the image tags are pushed:

```text
docker-registry.sephy.top/cc-connect:pr-<merged-pr-number>
docker-registry.sephy.top/cc-connect:sha-<short-merge-commit-sha>
docker-registry.sephy.top/cc-connect:latest
```

3. Confirm closing a PR without merging skips the job.
4. Confirm pushing directly to `main` does not trigger this workflow.
