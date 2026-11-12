import { JSDOM } from "jsdom";
const target = new URL(process.argv[2] || "http://127.0.0.1:3000");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.username ||
  target.password
) {
  throw new Error("This smoke test only runs against a local demo server.");
}
const base = target.origin;
const fetch = (url, options = {}) =>
  globalThis.fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
const home = await fetch(base);
const page = new JSDOM(await home.text()).window.document;
const cards = [...page.querySelectorAll(".decision-card h2")].map((el) => el.textContent);
if (cards.length !== 4 || !page.querySelector(".demo-banner")?.textContent.includes("Demo mode"))
  throw new Error("Start a fresh demo server. Expected four SSR cards and a Demo mode banner.");
const demo = await fetch(`${base}/api/decisions`);
const list = await demo.json();
if (demo.status !== 200 || list.mode !== "demo")
  throw new Error("Refusing writes: this server is not an auth-bypassed demo.");
const jsonRequest = async (path, body, method = "PATCH") =>
  fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify(body),
  });
const createdResponse = await jsonRequest(
  "/api/decisions",
  {
    question: "Local verification decision",
    area: "Other",
    options: ["First", "Second"],
    imageUrls: [`${base}/demo/rounded.svg`],
  },
  "POST",
);
const createdBody = await createdResponse.json();
const created = createdBody.decision;
if (createdResponse.status !== 201)
  throw new Error(`Create smoke failed: ${createdResponse.status} ${JSON.stringify(createdBody)}`);
const patch = (body) => jsonRequest(`/api/decisions/${created.id}`, body);
const answerResponse = await patch({
  action: "answer",
  answer: "First",
  custom: false,
  expectedRevision: created.revision,
});
const answered = (await answerResponse.json()).decision;
const changeResponse = await patch({
  action: "answer",
  answer: "Second",
  custom: false,
  expectedRevision: answered.revision,
});
const changed = (await changeResponse.json()).decision;
const staleResponse = await patch({ action: "reopen", expectedRevision: answered.revision });
const undoResponse = await patch({ action: "reopen", expectedRevision: changed.revision });
const reopened = (await undoResponse.json()).decision;
const customResponse = await patch({
  action: "answer",
  answer: "A custom direction",
  custom: true,
  expectedRevision: reopened.revision,
});
const custom = (await customResponse.json()).decision;
const routeResponse = await patch({ action: "route", expectedRevision: custom.revision });
const routed = (await routeResponse.json()).decision;
const lockedResponse = await patch({ action: "reopen", expectedRevision: routed.revision });
const journey = {
  create: createdResponse.status,
  answer: answerResponse.status,
  change: changeResponse.status,
  staleUndo: staleResponse.status,
  undo: undoResponse.status,
  custom: customResponse.status,
  route: routeResponse.status,
  routedLock: lockedResponse.status,
};
if (
  JSON.stringify(Object.values(journey)) !==
  JSON.stringify([201, 200, 200, 409, 200, 200, 200, 409])
)
  throw new Error(`Live journey smoke failed: ${JSON.stringify(journey)}`);
if (created.images?.[0]?.url !== `${base}/demo/rounded.svg`)
  throw new Error("Image URL smoke failed.");
const agentNoAuth = await fetch(`${base}/api/agent/decisions`);
const agentCookieOnly = await fetch(`${base}/api/agent/decisions`, {
  headers: { Cookie: "sb-test-auth-token=fixture" },
});
if (agentNoAuth.status !== 401 || agentCookieOnly.status !== 401)
  throw new Error("Agent API accepted missing bearer auth.");
let agentJourney = "Skipped: no AGENT_API_KEY on the smoke-test process.";
const agentKey = process.env.AGENT_API_KEY?.trim();
if (agentKey) {
  const agentRequest = (path, body) =>
    fetch(`${base}/api/agent/decisions${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${agentKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const bearerHuman = await fetch(`${base}/api/decisions`, {
    headers: { Authorization: `Bearer ${agentKey}` },
  });
  if (bearerHuman.status !== 200)
    throw new Error("Demo human endpoints should bypass authentication.");
  const agentCreated = await agentRequest("", {
    question: "Agent verification decision",
    area: "Other",
    options: ["Proceed", "Wait"],
  });
  if (agentCreated.status !== 201) throw new Error(`Agent create failed: ${agentCreated.status}`);
  const pending = (await agentCreated.json()).decision;
  const single = await agentRequest(`/${pending.id}`);
  if (single.status !== 200 || (await single.json()).decision.id !== pending.id)
    throw new Error("Agent get-one failed.");
  const upload = new FormData();
  upload.set(
    "decision",
    JSON.stringify({ question: "Agent image upload verification", area: "Design" }),
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUn8AAAAASUVORK5CYII=",
    "base64",
  );
  upload.append("images", new Blob([png], { type: "image/png" }), "sample.png");
  const uploaded = await fetch(`${base}/api/agent/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${agentKey}` },
    body: upload,
  });
  const uploadedDecision = (await uploaded.json()).decision;
  if (uploaded.status !== 201 || !uploadedDecision.images[0].url.startsWith("/api/demo/images/"))
    throw new Error("Agent image upload failed.");
  const imageResponse = await fetch(`${base}${uploadedDecision.images[0].url}`);
  if (imageResponse.status !== 200 || !Buffer.from(await imageResponse.arrayBuffer()).equals(png))
    throw new Error("Demo image bytes did not round-trip.");
  const humanAnswer = await jsonRequest(`/api/decisions/${pending.id}`, {
    action: "answer",
    answer: "Proceed",
    custom: false,
    expectedRevision: pending.revision,
  });
  if (humanAnswer.status !== 200) throw new Error("Human could not answer agent-created decision.");
  const latest = (await humanAnswer.json()).decision;
  const filtered = await agentRequest("?status=Answered");
  const answeredList = (await filtered.json()).decisions;
  if (
    !answeredList.some((d) => d.id === pending.id) ||
    answeredList.some((d) => d.status !== "Answered")
  )
    throw new Error("Agent status filter failed.");
  const stale = await agentRequest(`/${pending.id}/route`, { expectedRevision: pending.revision });
  const routedResponse = await agentRequest(`/${pending.id}/route`, {
    expectedRevision: latest.revision,
  });
  const locked = (await routedResponse.json()).decision;
  const lockedHuman = await jsonRequest(`/api/decisions/${pending.id}`, {
    action: "reopen",
    expectedRevision: locked?.revision,
  });
  if (stale.status !== 409 || routedResponse.status !== 200 || lockedHuman.status !== 409)
    throw new Error("Agent pickup conflict checks failed.");
  agentJourney = {
    create: agentCreated.status,
    getOne: single.status,
    upload: uploaded.status,
    humanAnswer: humanAnswer.status,
    filteredList: filtered.status,
    staleRoute: stale.status,
    route: routedResponse.status,
    humanLocked: lockedHuman.status,
    bearerHuman: bearerHuman.status,
  };
}
const results = {
  demoAuthBypassed: true,
  home: home.status,
  ssrCards: cards,
  demoAPI: demo.status,
  decisions: list.decisions.length,
  journey,
  agentJourney,
};
console.log(JSON.stringify(results, null, 2));
console.log("Demo smoke passed. Restart the demo server to reset the verification decision.");
