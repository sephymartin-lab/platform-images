# Reusable Feishu GitHub Actions Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable local GitHub composite action that sends Feishu card notifications, then wire it into the `cc-connect` Docker image publishing workflow for started, success, failure, and cancelled states.

**Architecture:** The notification primitive is a local composite action at `.github/actions/feishu-notify`. A small dependency-free Node.js script builds and sends Feishu interactive card payloads, including optional custom bot signing. The existing Docker workflow calls the action from separate start and finish notification jobs so the image build result remains clear and reusable notification behavior stays centralized.

**Tech Stack:** GitHub Actions, local composite actions, Node.js built-in modules (`crypto`, `https`, `node:test`), Feishu custom bot webhook cards, Docker Buildx.

## Global Constraints

- Keep direct `main` push publishing disabled.
- Keep the image repository fixed to `docker-registry.sephy.top/cc-connect`.
- Keep optional registry authentication: if both `DOCKER_REGISTRY_USERNAME` and `DOCKER_REGISTRY_PASSWORD` exist, log in; if neither exists, push anonymously.
- Keep current workflow support for manual `workflow_dispatch`.
- Preserve the current `self-hosted` runner selection and registry reachability check.
- Store Feishu secrets in GitHub Secrets as `FEISHU_WEBHOOK_URL` and optional `FEISHU_BOT_SECRET`.
- Use same-repository pull request branches for this workflow. GitHub does not expose repository secrets to `pull_request` workflows triggered from forked repositories, except `GITHUB_TOKEN`, so fork PRs cannot use the Feishu webhook secret with this design.
- Do not print Feishu webhook URLs, signing secrets, signatures, or full request headers.
- Use `rtk` before local shell commands.

---

## File Structure

- Create `.github/actions/feishu-notify/action.yml`: local composite action interface and execution wrapper.
- Create `.github/actions/feishu-notify/send-card.js`: dependency-free Node.js implementation for Feishu card construction, optional signing, HTTP delivery, and testable pure helpers.
- Create `.github/actions/feishu-notify/send-card.test.js`: Node built-in test coverage for card payloads, extra fields, and signing.
- Modify `.github/workflows/build-cc-connect-image.yml`: add `notify-start` and `notify-finish` jobs around the existing `build-and-push` job while preserving current build behavior.

## Task 1: Build The Reusable Feishu Notification Action

**Files:**
- Create: `.github/actions/feishu-notify/action.yml`
- Create: `.github/actions/feishu-notify/send-card.js`
- Create: `.github/actions/feishu-notify/send-card.test.js`

**Interfaces:**
- Consumes action inputs: `webhook`, `secret`, `status`, `title`, `summary`, `run-url`, `ref-name`, `sha`, `actor`, `repository`, `workflow`, `run-number`, `event-name`, `extra-fields`.
- Produces: one Feishu custom bot webhook POST using `msg_type: interactive`.
- Exports JavaScript helpers for tests: `buildPayload(input, timestamp)`, `normalizeExtraFields(raw)`, `sign(timestamp, secret)`, `shortSha(sha)`.

- [ ] **Step 1: Create the local action directory**

Run:

```bash
rtk mkdir -p .github/actions/feishu-notify
```

Expected: directory `.github/actions/feishu-notify` exists.

- [ ] **Step 2: Write the composite action metadata**

Create `.github/actions/feishu-notify/action.yml`:

```yaml
name: Feishu Notify
description: Send a Feishu interactive card notification from GitHub Actions.

inputs:
  webhook:
    description: Feishu custom bot webhook URL.
    required: true
  secret:
    description: Optional Feishu custom bot signing secret.
    required: false
    default: ""
  status:
    description: Notification status: started, success, failure, or cancelled.
    required: true
  title:
    description: Notification title.
    required: true
  summary:
    description: Short notification summary.
    required: false
    default: ""
  run-url:
    description: GitHub Actions run URL.
    required: true
  ref-name:
    description: Branch or tag name.
    required: false
    default: ""
  sha:
    description: Commit SHA.
    required: false
    default: ""
  actor:
    description: GitHub actor.
    required: false
    default: ""
  repository:
    description: GitHub repository.
    required: false
    default: ""
  workflow:
    description: GitHub workflow name.
    required: false
    default: ""
  run-number:
    description: GitHub workflow run number.
    required: false
    default: ""
  event-name:
    description: GitHub event name.
    required: false
    default: ""
  extra-fields:
    description: JSON object containing additional card fields.
    required: false
    default: "{}"

runs:
  using: composite
  steps:
    - name: Send Feishu card
      shell: bash
      env:
        FEISHU_WEBHOOK: ${{ inputs.webhook }}
        FEISHU_SECRET: ${{ inputs.secret }}
        NOTIFY_STATUS: ${{ inputs.status }}
        NOTIFY_TITLE: ${{ inputs.title }}
        NOTIFY_SUMMARY: ${{ inputs.summary }}
        RUN_URL: ${{ inputs.run-url }}
        REF_NAME: ${{ inputs.ref-name }}
        COMMIT_SHA: ${{ inputs.sha }}
        ACTOR: ${{ inputs.actor }}
        REPOSITORY: ${{ inputs.repository }}
        WORKFLOW: ${{ inputs.workflow }}
        RUN_NUMBER: ${{ inputs.run-number }}
        EVENT_NAME: ${{ inputs.event-name }}
        EXTRA_FIELDS: ${{ inputs.extra-fields }}
      run: node "${GITHUB_ACTION_PATH}/send-card.js"
```

- [ ] **Step 3: Write a failing unit test for card construction and signing**

Create `.github/actions/feishu-notify/send-card.test.js`:

```javascript
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPayload,
  normalizeExtraFields,
  shortSha,
  sign,
} = require("./send-card");

test("buildPayload creates a success interactive card with common and extra fields", () => {
  const payload = buildPayload(
    {
      status: "success",
      title: "cc-connect image publish",
      summary: "Image pushed.",
      runUrl: "https://github.com/sephymartin-lab/platform-images/actions/runs/123",
      refName: "main",
      sha: "abcdef1234567890",
      actor: "sephy",
      repository: "sephymartin-lab/platform-images",
      workflow: "Build cc-connect image",
      runNumber: "42",
      eventName: "workflow_dispatch",
      extraFields: {
        Image: "docker-registry.sephy.top/cc-connect",
        Tags: "latest, sha-abcdef1",
      },
      secret: "",
    },
    "1780000000",
  );

  assert.equal(payload.msg_type, "interactive");
  assert.equal(payload.card.header.template, "green");
  assert.equal(payload.card.header.title.content, "Succeeded: cc-connect image publish");
  assert.equal(payload.card.elements[0].text.content, "Image pushed.");

  const fields = payload.card.elements[2].fields.map((field) => field.text.content);
  assert.ok(fields.includes("**Repository:**\nsephymartin-lab/platform-images"));
  assert.ok(fields.includes("**Commit:**\nabcdef1"));
  assert.ok(fields.includes("**Image:**\ndocker-registry.sephy.top/cc-connect"));
  assert.ok(fields.includes("**Tags:**\nlatest, sha-abcdef1"));

  assert.equal(payload.card.elements[3].actions[0].url, "https://github.com/sephymartin-lab/platform-images/actions/runs/123");
});

test("buildPayload adds timestamp and sign when secret is provided", () => {
  const payload = buildPayload(
    {
      status: "started",
      title: "demo",
      summary: "Started.",
      runUrl: "https://github.com/example/repo/actions/runs/1",
      refName: "main",
      sha: "1234567",
      actor: "sephy",
      repository: "example/repo",
      workflow: "Demo",
      runNumber: "1",
      eventName: "workflow_dispatch",
      extraFields: {},
      secret: "secret-value",
    },
    "1780000000",
  );

  assert.equal(payload.timestamp, "1780000000");
  assert.equal(payload.sign, sign("1780000000", "secret-value"));
});

test("normalizeExtraFields accepts only a JSON object", () => {
  assert.deepEqual(normalizeExtraFields('{"Image":"demo","Tags":"latest"}'), {
    Image: "demo",
    Tags: "latest",
  });

  assert.throws(() => normalizeExtraFields("[]"), /EXTRA_FIELDS must be a JSON object/);
  assert.throws(() => normalizeExtraFields("{bad-json"), /EXTRA_FIELDS must be valid JSON/);
});

test("shortSha returns a seven character SHA when available", () => {
  assert.equal(shortSha("abcdef123456"), "abcdef1");
  assert.equal(shortSha(""), "");
});
```

- [ ] **Step 4: Run the test and verify it fails because the implementation does not exist**

Run:

```bash
rtk mise exec node@20 -- node --test .github/actions/feishu-notify/send-card.test.js
```

Expected: FAIL with an error that `./send-card` cannot be found.

- [ ] **Step 5: Write the Feishu card implementation**

Create `.github/actions/feishu-notify/send-card.js`:

```javascript
const crypto = require("node:crypto");
const https = require("node:https");

const STATUS_META = {
  started: {
    template: "blue",
    titlePrefix: "Started",
  },
  success: {
    template: "green",
    titlePrefix: "Succeeded",
  },
  failure: {
    template: "red",
    titlePrefix: "Failed",
  },
  cancelled: {
    template: "grey",
    titlePrefix: "Cancelled",
  },
};

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requireInput(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : "";
}

function normalizeExtraFields(raw) {
  if (!raw || raw.trim() === "") {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`EXTRA_FIELDS must be valid JSON: ${error.message}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("EXTRA_FIELDS must be a JSON object");
  }

  return parsed;
}

function sign(timestamp, secret) {
  return crypto
    .createHmac("sha256", `${timestamp}\n${secret}`)
    .update("")
    .digest("base64");
}

function field(label, value) {
  return {
    is_short: true,
    text: {
      tag: "lark_md",
      content: `**${label}:**\n${value || "-"}`,
    },
  };
}

function normalizeStatus(status) {
  if (!STATUS_META[status]) {
    throw new Error("NOTIFY_STATUS must be one of: started, success, failure, cancelled");
  }
  return status;
}

function buildPayload(input, timestamp = String(Math.floor(Date.now() / 1000))) {
  const status = normalizeStatus(input.status);
  const meta = STATUS_META[status];
  const title = requireInput("title", input.title);
  const runUrl = requireInput("runUrl", input.runUrl);

  const commonFields = [
    field("Repository", input.repository),
    field("Workflow", input.workflow),
    field("Run", input.runNumber),
    field("Ref", input.refName),
    field("Commit", shortSha(input.sha)),
    field("Actor", input.actor),
    field("Event", input.eventName),
  ];

  const extraFields = Object.entries(input.extraFields || {}).map(([key, value]) =>
    field(key, String(value)),
  );

  const payload = {
    msg_type: "interactive",
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: meta.template,
        title: {
          tag: "plain_text",
          content: `${meta.titlePrefix}: ${title}`,
        },
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: input.summary || "-",
          },
        },
        {
          tag: "hr",
        },
        {
          tag: "div",
          fields: [...commonFields, ...extraFields],
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: {
                tag: "plain_text",
                content: "Open GitHub Actions",
              },
              type: "primary",
              url: runUrl,
            },
          ],
        },
      ],
    },
  };

  if (input.secret) {
    payload.timestamp = timestamp;
    payload.sign = sign(timestamp, input.secret);
  }

  return payload;
}

function sendWebhook(webhook, payload) {
  const url = new URL(webhook);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        port: url.port || 443,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Feishu webhook returned HTTP ${response.statusCode}`));
            return;
          }

          try {
            const parsed = JSON.parse(responseBody);
            if (typeof parsed.code === "number" && parsed.code !== 0) {
              reject(new Error(`Feishu webhook returned code ${parsed.code}: ${parsed.msg || "unknown error"}`));
              return;
            }
          } catch (_error) {
            reject(new Error("Feishu webhook returned a non-JSON response"));
            return;
          }

          resolve();
        });
      },
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function main() {
  const webhook = requireInput("webhook", env("FEISHU_WEBHOOK"));
  const extraFields = normalizeExtraFields(env("EXTRA_FIELDS", "{}"));
  const payload = buildPayload({
    status: env("NOTIFY_STATUS"),
    title: env("NOTIFY_TITLE"),
    summary: env("NOTIFY_SUMMARY"),
    runUrl: env("RUN_URL"),
    refName: env("REF_NAME"),
    sha: env("COMMIT_SHA"),
    actor: env("ACTOR"),
    repository: env("REPOSITORY"),
    workflow: env("WORKFLOW"),
    runNumber: env("RUN_NUMBER"),
    eventName: env("EVENT_NAME"),
    extraFields,
    secret: env("FEISHU_SECRET"),
  });

  await sendWebhook(webhook, payload);
  console.log("Feishu notification sent.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildPayload,
  normalizeExtraFields,
  sendWebhook,
  shortSha,
  sign,
};
```

- [ ] **Step 6: Run unit tests**

Run:

```bash
rtk mise exec node@20 -- node --test .github/actions/feishu-notify/send-card.test.js
```

Expected: PASS. The output includes one test file and four passing tests.

- [ ] **Step 7: Run JavaScript syntax check**

Run:

```bash
rtk mise exec node@20 -- node --check .github/actions/feishu-notify/send-card.js
```

Expected: no output and exit code `0`.

- [ ] **Step 8: Run YAML parse check for the action metadata**

Run:

```bash
rtk ruby -e 'require "yaml"; YAML.load_file(".github/actions/feishu-notify/action.yml"); puts "yaml ok"'
```

Expected:

```text
yaml ok
```

- [ ] **Step 9: Commit the reusable action**

Run:

```bash
rtk git add .github/actions/feishu-notify/action.yml .github/actions/feishu-notify/send-card.js .github/actions/feishu-notify/send-card.test.js
rtk git commit -m "ci: add reusable feishu notification action"
```

Expected: commit succeeds and contains only the three files created in this task.

## Task 2: Wire Feishu Notifications Into The cc-connect Image Workflow

**Files:**
- Modify: `.github/workflows/build-cc-connect-image.yml`

**Interfaces:**
- Consumes local action: `./.github/actions/feishu-notify`.
- Consumes GitHub Secrets: `FEISHU_WEBHOOK_URL`, optional `FEISHU_BOT_SECRET`, optional Docker registry secrets.
- Produces Feishu cards for `started`, `success`, `failure`, and `cancelled` lifecycle states.
- Preserves Docker image output tags: `latest`, `sha-<short-sha>`, and `pr-<number>` for merged PR runs.

- [ ] **Step 1: Replace the workflow with the notification-enabled version**

Modify `.github/workflows/build-cc-connect-image.yml` to this content:

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
  notify-start:
    name: Notify start
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.pull_request.merged == true }}
    runs-on:
      - self-hosted
    continue-on-error: true
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Prepare notification fields
        id: fields
        shell: bash
        run: |
          short_sha="${GITHUB_SHA::7}"
          tags="latest, sha-${short_sha}"
          trigger="Manual run"

          if [ "${{ github.event_name }}" = "pull_request" ]; then
            tags="${tags}, pr-${{ github.event.pull_request.number }}"
            trigger="Merged PR #${{ github.event.pull_request.number }}"
          fi

          {
            echo "extra_fields<<JSON"
            printf '{"Image":"%s","Tags":"%s","Registry":"%s","Trigger":"%s"}\n' \
              "${IMAGE_NAME}" \
              "${tags}" \
              "${REGISTRY}" \
              "${trigger}"
            echo "JSON"
          } >> "${GITHUB_OUTPUT}"

      - name: Send start notification
        uses: ./.github/actions/feishu-notify
        with:
          webhook: ${{ secrets.FEISHU_WEBHOOK_URL }}
          secret: ${{ secrets.FEISHU_BOT_SECRET }}
          status: started
          title: cc-connect image publish
          summary: Docker image build and push started.
          run-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          ref-name: ${{ github.ref_name }}
          sha: ${{ github.sha }}
          actor: ${{ github.actor }}
          repository: ${{ github.repository }}
          workflow: ${{ github.workflow }}
          run-number: ${{ github.run_number }}
          event-name: ${{ github.event_name }}
          extra-fields: ${{ steps.fields.outputs.extra_fields }}

  build-and-push:
    name: Build and push image
    if: ${{ github.event_name == 'workflow_dispatch' || github.event.pull_request.merged == true }}
    runs-on:
      - self-hosted
    env:
      DOCKER_REGISTRY_USERNAME: ${{ secrets.DOCKER_REGISTRY_USERNAME }}
      DOCKER_REGISTRY_PASSWORD: ${{ secrets.DOCKER_REGISTRY_PASSWORD }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Verify registry is reachable
        run: |
          status="$(
            curl --silent --show-error --output /dev/null \
              --write-out "%{http_code}" \
              --connect-timeout 10 \
              --max-time 20 \
              "https://${REGISTRY}/v2/" || true
          )"

          case "${status}" in
            200|401) ;;
            *)
              echo "Registry ${REGISTRY} is not reachable from this runner; got HTTP ${status} from /v2/." >&2
              exit 1
              ;;
          esac

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

  notify-finish:
    name: Notify finish
    needs:
      - notify-start
      - build-and-push
    if: ${{ always() && (github.event_name == 'workflow_dispatch' || github.event.pull_request.merged == true) }}
    runs-on:
      - self-hosted
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Prepare notification result
        id: result
        shell: bash
        run: |
          case "${{ needs.build-and-push.result }}" in
            success)
              notify_status="success"
              summary="Docker image build and push completed successfully."
              ;;
            cancelled)
              notify_status="cancelled"
              summary="Docker image build and push was cancelled."
              ;;
            *)
              notify_status="failure"
              summary="Docker image build and push failed. Open the GitHub Actions run for logs."
              ;;
          esac

          short_sha="${GITHUB_SHA::7}"
          tags="latest, sha-${short_sha}"
          trigger="Manual run"

          if [ "${{ github.event_name }}" = "pull_request" ]; then
            tags="${tags}, pr-${{ github.event.pull_request.number }}"
            trigger="Merged PR #${{ github.event.pull_request.number }}"
          fi

          {
            echo "status=${notify_status}"
            echo "summary=${summary}"
            echo "extra_fields<<JSON"
            printf '{"Image":"%s","Tags":"%s","Registry":"%s","Trigger":"%s","Build Job Result":"%s"}\n' \
              "${IMAGE_NAME}" \
              "${tags}" \
              "${REGISTRY}" \
              "${trigger}" \
              "${{ needs.build-and-push.result }}"
            echo "JSON"
          } >> "${GITHUB_OUTPUT}"

      - name: Send finish notification
        uses: ./.github/actions/feishu-notify
        with:
          webhook: ${{ secrets.FEISHU_WEBHOOK_URL }}
          secret: ${{ secrets.FEISHU_BOT_SECRET }}
          status: ${{ steps.result.outputs.status }}
          title: cc-connect image publish
          summary: ${{ steps.result.outputs.summary }}
          run-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          ref-name: ${{ github.ref_name }}
          sha: ${{ github.sha }}
          actor: ${{ github.actor }}
          repository: ${{ github.repository }}
          workflow: ${{ github.workflow }}
          run-number: ${{ github.run_number }}
          event-name: ${{ github.event_name }}
          extra-fields: ${{ steps.result.outputs.extra_fields }}
```

- [ ] **Step 2: Verify direct push trigger is still absent**

Run:

```bash
rtk rg -n "^  push:|^on:|pull_request|workflow_dispatch|merged|branches:" .github/workflows/build-cc-connect-image.yml
```

Expected output includes `workflow_dispatch`, `pull_request`, `closed`, `branches`, `main`, and the merged PR guard. Expected output does not include `push:`.

- [ ] **Step 3: Verify notification jobs and local action calls exist**

Run:

```bash
rtk rg -n "notify-start|notify-finish|feishu-notify|FEISHU_WEBHOOK_URL|FEISHU_BOT_SECRET|always\\(\\)|needs.build-and-push.result" .github/workflows/build-cc-connect-image.yml
```

Expected output includes:

```text
notify-start
notify-finish
./.github/actions/feishu-notify
FEISHU_WEBHOOK_URL
FEISHU_BOT_SECRET
always()
needs.build-and-push.result
```

- [ ] **Step 4: Verify existing Docker publishing behavior is preserved**

Run:

```bash
rtk rg -n "self-hosted|Verify registry is reachable|docker-registry\\.sephy\\.top/cc-connect|context: cc-connect|file: cc-connect/Dockerfile|platforms: linux/amd64|push: true|type=raw,value=latest|type=sha,prefix=sha-,format=short" .github/workflows/build-cc-connect-image.yml
```

Expected output includes all of:

```text
self-hosted
Verify registry is reachable
docker-registry.sephy.top/cc-connect
context: cc-connect
file: cc-connect/Dockerfile
platforms: linux/amd64
push: true
type=raw,value=latest
type=sha,prefix=sha-,format=short
```

- [ ] **Step 5: Run YAML parse checks**

Run:

```bash
rtk ruby -e 'require "yaml"; YAML.load_file(".github/workflows/build-cc-connect-image.yml"); YAML.load_file(".github/actions/feishu-notify/action.yml"); puts "yaml ok"'
```

Expected:

```text
yaml ok
```

- [ ] **Step 6: Run notification action tests again**

Run:

```bash
rtk mise exec node@20 -- node --test .github/actions/feishu-notify/send-card.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit workflow integration**

Run:

```bash
rtk git add .github/workflows/build-cc-connect-image.yml
rtk git commit -m "ci: notify feishu for cc-connect image workflow"
```

Expected: commit succeeds and contains only `.github/workflows/build-cc-connect-image.yml`.

## Task 3: Validate The GitHub Actions Flow In GitHub

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes GitHub repository secrets: `FEISHU_WEBHOOK_URL`, optional `FEISHU_BOT_SECRET`.
- Consumes the manual trigger in `.github/workflows/build-cc-connect-image.yml`.
- Produces Feishu start and finish cards plus Docker image tags.

- [ ] **Step 1: Configure Feishu secrets**

In GitHub repository settings, set:

```text
FEISHU_WEBHOOK_URL
FEISHU_BOT_SECRET
```

Expected: `FEISHU_WEBHOOK_URL` exists. `FEISHU_BOT_SECRET` exists only if the Feishu bot has signature verification enabled.

- [ ] **Step 2: Push the branch or merge the PR containing the workflow changes**

Run:

```bash
rtk git status --short --branch --untracked-files=all
```

Expected: no uncommitted files from the Feishu implementation remain before pushing or opening a PR.

- [ ] **Step 3: Trigger the workflow manually**

In GitHub:

```text
Actions -> Build cc-connect image -> Run workflow
```

Expected: the workflow starts on the selected branch, sends a Feishu `started` card, builds and pushes the image, then sends a `success` card if the build succeeds.

- [ ] **Step 4: Verify Docker image tags**

After the manual run succeeds, verify these tags exist in the registry:

```text
docker-registry.sephy.top/cc-connect:latest
docker-registry.sephy.top/cc-connect:sha-<short-sha>
```

Expected: both tags are present. Manual runs do not produce a `pr-<number>` tag.

- [ ] **Step 5: Verify merged PR behavior**

Merge a PR into `main`.

Expected: the workflow starts after PR merge and sends:

```text
started card
success card
```

Expected image tags:

```text
docker-registry.sephy.top/cc-connect:latest
docker-registry.sephy.top/cc-connect:sha-<short-sha>
docker-registry.sephy.top/cc-connect:pr-<number>
```

- [ ] **Step 6: Verify failure notification with a controlled test branch**

Create a temporary branch that changes the registry reachability check URL to an invalid host, open a PR, and merge it only in a disposable test repository or after deciding the temporary failure is acceptable.

Expected: the workflow sends a `started` card and then a `failure` card with a GitHub Actions run link.

- [ ] **Step 7: Revert the controlled failure change if it was made in this repository**

Run:

```bash
rtk git revert <temporary-failure-test-commit-sha>
```

Expected: the temporary failure injection is removed and the normal registry URL is restored.
