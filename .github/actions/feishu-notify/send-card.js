const crypto = require("node:crypto");
const https = require("node:https");

const WEBHOOK_TIMEOUT_MS = 10_000;

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
              reject(new Error(`Feishu webhook returned code ${parsed.code}: ${parsed.msg || parsed.StatusMessage || "unknown error"}`));
              return;
            }

            if (typeof parsed.StatusCode === "number" && parsed.StatusCode !== 0) {
              reject(new Error(`Feishu webhook returned StatusCode ${parsed.StatusCode}: ${parsed.StatusMessage || parsed.msg || "unknown error"}`));
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
    request.setTimeout(WEBHOOK_TIMEOUT_MS, () => {
      request.destroy(new Error("Feishu webhook request timed out"));
    });
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
