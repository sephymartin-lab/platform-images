#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_TAG="${1:-ci-all-in-one:$(date +%Y%m%d%H%M)}"
IMAGE_REPOSITORY="${IMAGE_TAG%%:*}"
DOCKERFILE_SHA="$(sha256sum "${SCRIPT_DIR}/Dockerfile" | awk '{print $1}')"
DOCKERFILE_SHA_LABEL="qnvip.ci-all-in-one.dockerfile-sha"
FORCE_BUILD="${FORCE_BUILD:-0}"
PLATFORMS="${PLATFORMS:-linux/amd64}"

if [[ "${FORCE_BUILD}" != "1" && "${PLATFORMS}" != *,* ]]; then
  expected_arch="${PLATFORMS#linux/}"

  while IFS= read -r existing_image; do
    [[ -n "${existing_image}" ]] || continue

    existing_sha="$(docker image inspect \
      --format "{{ index .Config.Labels \"${DOCKERFILE_SHA_LABEL}\" }}" \
      "${existing_image}" 2>/dev/null || true)"
    existing_arch="$(docker image inspect \
      --format "{{ .Architecture }}" \
      "${existing_image}" 2>/dev/null || true)"

    if [[ "${existing_sha}" == "${DOCKERFILE_SHA}" && "${existing_arch}" == "${expected_arch}" ]]; then
      printf 'Skip build: %s already matches Dockerfile sha %s for %s\n' "${existing_image}" "${DOCKERFILE_SHA}" "${PLATFORMS}"
      exit 0
    fi
  done < <(docker image ls "${IMAGE_REPOSITORY}" --format '{{.Repository}}:{{.Tag}}')
fi

docker buildx build \
  --platform "${PLATFORMS}" \
  --label "${DOCKERFILE_SHA_LABEL}=${DOCKERFILE_SHA}" \
  -t "${IMAGE_TAG}" \
  "${SCRIPT_DIR}"
