// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";
import { Dashboard } from "@/components/dashboard";
import { MockStore } from "@/lib/stores/mock";
import { seedDecisions } from "@/lib/seed";
import { demoEnv } from "./fixtures";
import { GET, POST } from "@/app/api/decisions/route";
import { PATCH } from "@/app/api/decisions/[id]/route";

let store: MockStore;
vi.mock("@/lib/store", () => ({ getStore: () => store }));
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

beforeEach(() => {
  demoEnv();
  store = new MockStore();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method || "GET";
      const request = new NextRequest(`http://localhost:3000${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: init?.body,
      });
      if (method === "PATCH")
        return PATCH(request, { params: Promise.resolve({ id: path.split("/").pop()! }) });
      return method === "POST" ? POST(request) : GET(request);
    }),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function setup() {
  const user = userEvent.setup();
  render(
    <Dashboard
      mode="demo"
      initialNow={Date.parse("2026-11-10T14:00:00Z")}
      initialDecisions={seedDecisions()}
    />,
  );
  const main = within(screen.getByRole("main"));
  return { user, main, open: () => within(main.getByRole("region", { name: "Open decisions" })) };
}

describe("complete local inbox journeys using the real API handlers", () => {
  it("scopes choices, answers, undoes, changes an answer, and locks Routed rows", async () => {
    const { user, main, open } = setup();
    let group = open().getByRole("article", { name: "Which logo should we use?" });
    expect(within(group).queryByRole("button", { name: "Approve it" })).toBeNull();
    expect(within(group).getByRole("button", { name: "Record audio" })).toBeTruthy();
    expect(within(group).getByLabelText("Add image")).toBeTruthy();
    const fullImage = within(group).getByRole("link", { name: "View Rounded mark full size" });
    expect(fullImage.getAttribute("href")).toBe("/demo/rounded.svg");
    expect(fullImage.getAttribute("target")).toBe("_blank");
    expect(within(fullImage).getByRole("img").getAttribute("src")).toBe("/demo/rounded.svg");
    await user.click(main.getByRole("button", { name: "Approve it" }));
    await waitFor(() =>
      expect(open().queryByRole("article", { name: "Approve the newsletter draft?" })).toBeNull(),
    );
    expect((await store.list()).find((d) => d.id.startsWith("2222"))?.answer).toBe("Approve it");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(open().getByRole("article", { name: "Approve the newsletter draft?" })).toBeTruthy(),
    );
    await user.click(main.getByRole("button", { name: "Revise it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy());
    await user.click(main.getByText("Answered", { exact: true, selector: ".answered-heading" }));
    await user.click(main.getByRole("button", { name: "Change answer" }));
    await user.click(main.getByRole("button", { name: "Approve it" }));
    await waitFor(async () =>
      expect((await store.list()).find((d) => d.id.startsWith("2222"))?.answer).toBe("Approve it"),
    );
    const imageDecision = (await store.list()).find((d) => d.id.startsWith("2222"))!;
    await store.mutate(imageDecision.id, {
      action: "route",
      expectedRevision: imageDecision.revision,
    });
    await user.click(screen.getByRole("button", { name: "Refresh inbox" }));
    await waitFor(() => expect(main.getByText("Picked up by assistant")).toBeTruthy());
    expect(main.queryByRole("button", { name: "Change answer" })).toBeNull();
    group = open().getByRole("article", { name: "Which logo should we use?" });
    expect(within(group).getByRole("button", { name: "Rounded mark" })).toBeTruthy();
  });

  it("sends a custom-only answer and filters areas with a friendly empty state", async () => {
    const { user, main, open } = setup();
    const card = open().getByRole("article", { name: "What should we name the next release?" });
    await user.type(within(card).getByRole("textbox"), "Spring release");
    await user.click(within(card).getByRole("button", { name: /Send custom answer/ }));
    await waitFor(() =>
      expect(
        open().queryByRole("article", { name: "What should we name the next release?" }),
      ).toBeNull(),
    );
    expect((await store.list()).find((d) => d.id.startsWith("3333"))).toMatchObject({
      answer: "Spring release",
      customAnswer: "Spring release",
      status: "Answered",
    });
    await user.click(main.getByRole("button", { name: "Tuesday morning" }));
    await waitFor(() => expect(open().getAllByRole("article")).toHaveLength(2));
    await user.click(main.getByRole("button", { name: /^Other/ }));
    expect(main.getByRole("heading", { name: "A clear inbox for Other." })).toBeTruthy();
    await user.click(main.getByRole("button", { name: "See all decisions" }));
    expect(open().getAllByRole("article")).toHaveLength(2);
  });

  it("adds a decision with its own options and a São Paulo deadline", async () => {
    const { user, main, open } = setup();
    await user.click(main.getByRole("button", { name: "Add decision" }));
    const dialog = screen.getByRole("dialog");
    const fields = within(dialog);
    await user.type(
      fields.getByRole("textbox", { name: /The question/ }),
      "Which design should we ship?",
    );
    await user.type(fields.getByRole("textbox", { name: /Answer options/ }), "Warm\nMinimal");
    await user.selectOptions(fields.getByRole("combobox"), "Content");
    await user.type(
      fields.getByRole("textbox", { name: /Image URL/ }),
      "https://example.com/design.png",
    );
    const deadline = dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    // JSDOM does not expose a role for datetime-local.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(deadline, { target: { value: "2026-11-11T09:30" } });
    await user.click(fields.getByRole("button", { name: "Add decision" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const created = (await store.list()).find(
      (d) => d.question === "Which design should we ship?",
    )!;
    expect(created).toMatchObject({
      options: ["Warm", "Minimal"],
      area: "Content",
      deadline: "2026-11-11T12:30:00.000Z",
      images: [expect.objectContaining({ url: "https://example.com/design.png" })],
    });
    expect(open().getByRole("article", { name: "Which design should we ship?" })).toBeTruthy();
  });
});
