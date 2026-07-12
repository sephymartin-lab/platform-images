const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const https = require("node:https");
const test = require("node:test");

const {
  buildPayload,
  normalizeExtraFields,
  sendWebhook,
  shortSha,
} = require("./send-card");

function mockHttpsRequest(t, handler) {
  const originalRequest = https.request;
  https.request = (options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => handler({ options, callback, request });
    request.destroy = (error) => request.emit("error", error);
    request.setTimeout = (timeout, onTimeout) => {
      request.timeout = timeout;
      request.onTimeout = onTimeout;
    };
    return request;
  };
  t.after(() => {
    https.request = originalRequest;
  });
}

function respond(callback, body, statusCode = 200) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  response.setEncoding = () => {};
  callback(response);
  process.nextTick(() => {
    response.emit("data", JSON.stringify(body));
    response.emit("end");
  });
}

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
  assert.equal(payload.sign, "efg0FoFmZVo1d9rYxnhZ3pi3EE3q6zZy1iD5DFA+4W4=");
});

test("sendWebhook accepts modern and legacy successful response envelopes", async (t) => {
  const responses = [{ code: 0 }, { StatusCode: 0 }];
  mockHttpsRequest(t, ({ callback }) => {
    respond(callback, responses.shift());
  });

  await sendWebhook("https://example.test/webhook", { msg_type: "interactive" });
  await sendWebhook("https://example.test/webhook", { msg_type: "interactive" });
});

test("sendWebhook rejects modern application-level errors", async (t) => {
  mockHttpsRequest(t, ({ callback }) => {
    respond(callback, { code: 19001, msg: "invalid request" });
  });

  await assert.rejects(
    sendWebhook("https://example.test/webhook", { msg_type: "interactive" }),
    /Feishu webhook returned code 19001: invalid request/,
  );
});

test("sendWebhook rejects legacy application-level errors", async (t) => {
  mockHttpsRequest(t, ({ callback }) => {
    respond(callback, { StatusCode: 19002, StatusMessage: "legacy error" });
  });

  await assert.rejects(
    sendWebhook("https://example.test/webhook", { msg_type: "interactive" }),
    /Feishu webhook returned StatusCode 19002: legacy error/,
  );
});

test("sendWebhook rejects when the request times out", async (t) => {
  mockHttpsRequest(t, ({ request }) => {
    assert.equal(request.timeout, 10_000);
    request.onTimeout();
  });

  await assert.rejects(
    sendWebhook("https://example.test/webhook", { msg_type: "interactive" }),
    /Feishu webhook request timed out/,
  );
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
