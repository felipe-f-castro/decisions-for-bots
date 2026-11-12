export function webhookHealthKey(health: { state: string }) {
  return JSON.stringify(health);
}

export function webhookSetupInstructions() {
  return `# Set up Decisions answer notifications

Decisions can POST a signed webhook when a person answers a card. The status indicator is not "Working" until a real delivery or the built-in test succeeds. A saved URL is not enough.

Do not invent hostnames, emails, routine IDs, or secrets. Do not print secrets in chat, logs, or the repository. Do not commit .env files.

## 1. Obtain a receiver

Create or obtain an HTTPS endpoint the assistant controls. You need two values from the user (or from a secret store they already use):

- The decision-answered automation webhook URL. It must be HTTPS in production (HTTP is accepted only for a local receiver). No username or password in the URL.
- The shared webhook secret. This is the same secret Decisions will use to sign the body.

Do not hardcode a product-specific routine ID, a personal email, or a live domain. Ask the user, or create a new HTTPS receiver they control and then store its URL and secret.

The receiver must:

- Accept POST with Content-Type: application/json
- Read the raw body bytes before parsing JSON
- Verify the header X-Decisions-Signature is sha256= plus HMAC-SHA256 of those raw bytes, using the shared secret
- Optionally also check Authorization: Bearer <shared secret>
- Read X-Decisions-Event
- Respond with an HTTP status from 200 to 299 within 3 seconds
- Not rely on redirects. Decisions does not follow them and treats a redirect as failure
- Treat event webhook.test (JSON field "test": true) as a connectivity check, not as a real decision

Signature check (Node.js), using the secret variable and the exact raw body:

    import { createHmac } from "node:crypto";
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    const received = request.headers["x-decisions-signature"];
    // Compare expected and received in constant time.

Decisions sends these headers:

- Content-Type: application/json
- X-Decisions-Event: decision.answered for a real answer, or webhook.test for the button "Send test notification"
- X-Decisions-Signature: sha256=<hex>
- Authorization: Bearer <shared secret>

Delivery is attempted twice. Each attempt times out after 3 seconds.

A real answer body looks like this. answer_media is empty when the reply is text only:

    {
      "event": "decision.answered",
      "decision": {
        "id": "<decision uuid>",
        "question": "<question>",
        "area": "<area>",
        "waiting_on": "<who is waiting>",
        "answer": "<saved answer, or empty when the reply is media only>",
        "custom_answer": "<same as answer when custom, otherwise empty>",
        "answered_at": "<ISO-8601 timestamp>",
        "answer_media": [
          {
            "id": "<file uuid>",
            "kind": "image or audio",
            "url": "<origin>/api/agent/decisions/<id>/media/<file uuid>",
            "content_type": "image/png or audio/webm",
            "filename": "<name>",
            "alt": "<image description, empty for audio>",
            "duration_seconds": null
          }
        ]
      }
    }

Fetch each answer_media url with Authorization: Bearer <agent API key>. The same bearer is required. A browser session cookie cannot fetch the agent URL. At most one image and one audio item. duration_seconds is a number of seconds for audio when known, otherwise null.

A test body uses "event": "webhook.test", "test": true, and a decision id of 00000000-0000-4000-8000-000000000000. Ignore it except as proof the receiver is reachable.

## 2. Save the URL and secret in Decisions

Sign in as the workspace owner and open /settings.

- Field "Answer webhook URL" (form name webhookUrl): the HTTPS receiver URL. Leave blank to turn delivery off.
- Field "Webhook secret" (form name webhookSecret): the shared secret, 16 to 256 characters, one line. Leave blank to keep the secret already stored. The field is write-only. Decisions never shows the secret again.
- Save with "Save settings".

First-run /setup can take the webhook URL and generates a webhook secret that is shown once. If the assistant already has a shared secret, paste that secret into /settings so both sides match. That replaces the generated secret and marks notifications as not verified until the next test.

There is no public API that sets the webhook. Do not put the secret in Site environment variables, git, or chat. Server-only fallbacks, if the user explicitly wants them for a local process, are DECISION_WEBHOOK_URL and DECISION_WEBHOOK_SECRET. When a URL or secret is saved in settings, that value overrides the matching environment variable.

Changing the URL or the secret clears the previous result. The indicator returns to "Not verified" until a new test or a real answer succeeds.

## 3. Confirm it works

On /settings, press "Send test notification". Decisions POSTs the webhook.test event above. It does not create a decision card.

Success looks like all of the following:

- The receiver responds with HTTP 2xx within 3 seconds and does not redirect
- The signature check on the raw body succeeds
- The Decisions status, on /settings and on the inbox, says "Working"
- The detail names a connectivity test or a delivered answer and a time

Then answer one real card (a test question is fine) and confirm the receiver gets event decision.answered and the indicator still says "Working".

These states are not success:

- "Not configured" — no webhook URL is saved and no server URL is set
- "Not verified" — a URL is saved, but this URL has never had a successful test or delivery. Do not treat a saved URL as working
- "Last delivery failed" — the last test or delivery did not succeed. The error is a short safe sentence such as "The receiver returned HTTP 502." or "The receiver did not respond in time." It never includes the secret, the URL, or the response body

If it fails, fix the receiver or the URL, save settings if needed, and send the test again.
`;
}
