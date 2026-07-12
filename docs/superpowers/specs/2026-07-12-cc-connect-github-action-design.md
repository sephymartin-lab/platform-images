# cc-connect GitHub Action Design

## Goal

Create a GitHub Actions workflow that builds `cc-connect/Dockerfile` and pushes
the resulting image to `docker-registry.sephy.top/cc-connect`.

## Final Constraints

- The image repository is fixed to `docker-registry.sephy.top/cc-connect`.
- The workflow must not run on direct pushes to `main`.
- The workflow runs automatically after a pull request is merged and can also be
  triggered manually from GitHub Actions.
- The Dockerfile build context is `cc-connect`.
- The Dockerfile supports only `linux/amd64`, so the workflow builds
  `linux/amd64` only.
- Registry credentials are optional. If both credential secrets are configured,
  the workflow logs in before pushing. If neither is configured, the workflow
  pushes anonymously.

## Recommended Trigger

Use two triggers:

- `pull_request` with `types: [closed]`, then gate that path with
  `github.event.pull_request.merged == true`.
- `workflow_dispatch` for manual runs from GitHub Actions.

This means:

- Opening, updating, or closing an unmerged PR does not push an image.
- Merging a PR into `main` triggers the build once.
- Manually running the workflow from GitHub Actions triggers a build.
- Direct pushes to `main` do not trigger this workflow.
- The workflow remains compatible with a repository that requires changes to go
  through pull requests.

## Workflow Shape

Create `.github/workflows/build-cc-connect-image.yml`.

The workflow should:

1. Check out the merged repository state.
2. Set up Docker Buildx.
3. Validate that registry credential secrets are either both configured or both
   absent.
4. Log in to `docker-registry.sephy.top` only when both credential secrets are
   configured.
5. Build `cc-connect/Dockerfile` with context `cc-connect`.
6. Push tags to `docker-registry.sephy.top/cc-connect`.

## Registry Authentication

Use these optional repository secrets:

- `DOCKER_REGISTRY_USERNAME`: username for `docker-registry.sephy.top`
- `DOCKER_REGISTRY_PASSWORD`: password or token for `docker-registry.sephy.top`

Behavior:

- If both secrets are empty or absent, the workflow skips `docker/login-action`
  and pushes anonymously.
- If both secrets are configured, the workflow runs `docker/login-action` before
  building and pushing.
- If only one secret is configured, the workflow fails before build/push because
  the registry credentials are incomplete.

GitHub Actions does not allow direct `secrets.*` references in `if:`
conditionals, so the workflow maps the secrets to job-level environment
variables and uses those `env.*` values for conditional steps.

## Image Tags

Push these tags:

- `latest` for consumers that want the newest pushed build.
- `sha-<short-sha>` for immutable source traceability.
- `pr-<number>` only for merged PR runs, for traceability to the merged PR.

Example tags:

```text
docker-registry.sephy.top/cc-connect:latest
docker-registry.sephy.top/cc-connect:pr-12
docker-registry.sephy.top/cc-connect:sha-a1b2c3d
```

## Permissions

The workflow only needs repository read access plus external registry
credentials:

```yaml
permissions:
  contents: read
```

No GitHub Packages permission is required because the target registry is
external.

## Build Cache

Use GitHub Actions cache through Docker Buildx:

- `cache-from: type=gha`
- `cache-to: type=gha,mode=max`

This keeps repeated Docker builds faster without coupling the workflow to a
registry-side cache policy.

## Failure Behavior

- If only one credential secret is configured, the job fails before build/push.
- If anonymous push is disabled and no credentials are configured, the build
  push step fails with an authentication or authorization error.
- If the Dockerfile becomes incompatible with `linux/amd64`, the Docker build
  fails.
- If a PR is closed without merge, the job is skipped.
- If the workflow is triggered manually, no `pr-<number>` tag is generated
  because there is no pull request number.

## Non-Goals

- Do not implement direct `main` push publishing.
- Do not publish multi-architecture images.
- Do not modify `cc-connect/Dockerfile` as part of this workflow design.
