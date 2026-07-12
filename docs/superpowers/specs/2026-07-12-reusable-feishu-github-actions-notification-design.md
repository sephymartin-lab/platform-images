# Reusable Feishu GitHub Actions Notification Design

## Goal

Add a reusable Feishu notification design for GitHub Actions workflows. The
first consumer is the `cc-connect` image publishing workflow, but the
notification module must be reusable by other workflows without duplicating
Feishu card payloads, webhook signing logic, or success/failure handling.

## Scope

The notification module sends Feishu interactive card messages at workflow
start and workflow completion.

The completion notification must support:

- Success notification when the workflow completes successfully.
- Failure notification when any required job fails.
- Cancelled notification when GitHub reports the run as cancelled.

The design does not change Docker image build behavior. It only adds a reusable
notification layer around existing workflows.

## Recommended Architecture

Use a reusable composite GitHub Action as the notification primitive.

Create a local action such as:

```text
.github/actions/feishu-notify/action.yml
```

Each workflow calls this action explicitly:

- Once near the beginning with `status: started`.
- Once in a final notification job or final step with `if: always()` and
  `status: success | failure | cancelled`.

This keeps the Feishu integration in one place while letting each workflow
decide when notification should happen and what workflow-specific fields should
appear in the card.

If multiple repositories need this later, promote the same composite action to a
shared repository and reference it with a pinned tag, for example:

```yaml
uses: sephymartin-lab/github-actions/.github/actions/feishu-notify@v1
```

For the current repository, start with a local composite action because it keeps
review, iteration, and versioning simple.

## Secrets And Inputs

Use repository or organization secrets:

- `FEISHU_WEBHOOK_URL`: required Feishu custom bot webhook URL.
- `FEISHU_BOT_SECRET`: optional signing secret if the Feishu bot enables
  signature verification.

The composite action accepts these inputs:

- `webhook`: Feishu webhook URL.
- `secret`: optional Feishu signing secret.
- `status`: one of `started`, `success`, `failure`, `cancelled`.
- `title`: card title, for example `cc-connect image publish`.
- `summary`: short human-readable summary.
- `run-url`: GitHub Actions run URL.
- `ref-name`: branch or tag name.
- `sha`: commit SHA.
- `actor`: GitHub actor.
- `repository`: GitHub repository.
- `workflow`: GitHub workflow name.
- `extra-fields`: optional JSON string for workflow-specific fields such as
  image tags, PR number, or target registry.

The composite action should fail fast if `webhook` is empty. If `secret` is
empty, it sends an unsigned webhook request. If `secret` is present, it signs
the request according to Feishu custom bot requirements.

## Data Flow

For `cc-connect`, the workflow should be structured as three logical jobs:

1. `notify-start`: send a `started` card.
2. `build-and-push`: build and push the Docker image.
3. `notify-finish`: run with `if: always()`, inspect `needs.build-and-push.result`,
   and send `success`, `failure`, or `cancelled`.

The final notification job must depend on both the start notification and the
build job:

```yaml
needs:
  - notify-start
  - build-and-push
if: ${{ always() }}
```

The final job should compute status from `needs.build-and-push.result`.

For a single-job workflow, the same action can also be called as:

```yaml
- name: Notify started
  uses: ./.github/actions/feishu-notify

- name: Main work
  id: main-work
  run: ...

- name: Notify finished
  if: ${{ always() }}
  uses: ./.github/actions/feishu-notify
```

For the Docker image publishing workflow, a final notification job is preferred
because it reports the whole job result and is easier to reuse in workflows with
multiple build/test/deploy jobs.

## Card Content

Use one consistent Feishu card layout with color and title varying by status:

- `started`: blue card, title `Started: <title>`.
- `success`: green card, title `Succeeded: <title>`.
- `failure`: red card, title `Failed: <title>`.
- `cancelled`: gray card, title `Cancelled: <title>`.

Each card should include:

- Repository.
- Workflow name.
- Run number.
- Branch or tag.
- Short commit SHA.
- Actor.
- Event name.
- Summary.
- A button linking to the GitHub Actions run.

For `cc-connect`, add workflow-specific fields:

- Image: `docker-registry.sephy.top/cc-connect`.
- Tags: `latest`, `sha-<short-sha>`, and `pr-<number>` for merged PR runs.
- Trigger: manual run or merged PR.

The notification action must not print secrets. Any debug output must avoid
printing webhook URLs, signatures, or Feishu secrets.

## Error Handling

Notification failures should not mask the real workflow result.

Recommended behavior:

- Start notification failure should fail only the `notify-start` job but should
  not block `build-and-push`.
- Final notification failure should fail the `notify-finish` job so the failed
  notification is visible in GitHub Actions.
- The Docker image build/push result remains visible through the
  `build-and-push` job result.

If notification delivery must never affect workflow status, individual
workflow callers can set `continue-on-error: true` on notification jobs or
steps. The default should be strict enough to expose broken notification
configuration during rollout.

## Security

- Store Feishu webhook and signing secret in GitHub Secrets.
- Prefer organization secrets if many repositories will reuse the action.
- Use environment variables for secrets inside the action scripts.
- Do not echo the webhook, signing secret, request body signature, or full
  request headers.
- Pin third-party actions by major version for normal use. For stricter supply
  chain control later, pin them by commit SHA.

## Reuse Model

The reusable action is deliberately small: it only knows how to send Feishu
cards. It does not know how to build Docker images, deploy services, or infer
business-specific metadata.

Each workflow owns:

- When to send notifications.
- Which jobs count toward final status.
- Which extra fields matter for that workflow.

The notification action owns:

- Feishu signing.
- Card JSON construction.
- HTTP delivery.
- Common validation and secret-safe logging.

This boundary lets new workflows reuse notification behavior with minimal YAML:

```yaml
uses: ./.github/actions/feishu-notify
with:
  webhook: ${{ secrets.FEISHU_WEBHOOK_URL }}
  secret: ${{ secrets.FEISHU_BOT_SECRET }}
  status: started
  title: my workflow
  summary: Workflow started.
  run-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

## Validation Plan

Validate the design in stages:

1. Run YAML parsing checks locally.
2. Use a manual `workflow_dispatch` run to verify the start card is delivered.
3. Force a controlled failure in a temporary test branch or PR to verify the
   failure card.
4. Run a successful manual workflow to verify the success card.
5. Confirm merged PR runs send PR-specific fields and still push Docker image
   tags.

## Open Decisions

The implementation should confirm these before coding:

- Whether `FEISHU_BOT_SECRET` is enabled on the Feishu bot.
- Whether notification failures should block workflow status in production or
  only during initial rollout.
- Whether the composite action should remain local to this repository or be
  promoted immediately to a shared actions repository.
