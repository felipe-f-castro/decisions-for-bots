// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "@/components/dashboard";
import { SettingsForm } from "@/components/settings-form";
import { WebhookStatus } from "@/components/webhook-status";
import { seedDecisions } from "@/lib/seed";
import { webhookSetupInstructions } from "@/lib/webhook-instructions";
import type { PublicWebhookHealth } from "@/lib/webhook-status";

vi.mock("@/app/actions", () => ({
  sendWebhookTest: vi.fn(),
  updateSettings: vi.fn(),
  signOut: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const secret = "fixture-webhook-secret-value";
const failed: PublicWebhookHealth = {
  state: "failed",
  source: "settings",
  at: "2026-11-12T15:00:00.000Z",
  kind: "delivery",
  error: "The receiver returned HTTP 502.",
};

describe("webhook status indicator", () => {
  it("distinguishes unconfigured, unverified, working, and failed", () => {
    const { rerender } = render(<WebhookStatus health={{ state: "unconfigured" }} allowTest />);
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send test notification" })).toBeNull();

    rerender(
      <WebhookStatus
        health={{
          state: "unknown",
          source: "settings",
          detail: "A webhook URL is saved, but Decisions has not confirmed a delivery yet.",
        }}
        allowTest
      />,
    );
    expect(screen.getByText("Not verified")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send test notification" })).toBeTruthy();

    rerender(
      <WebhookStatus
        health={{
          state: "ok",
          source: "settings",
          at: "2026-11-12T15:00:00.000Z",
          kind: "test",
        }}
        allowTest
      />,
    );
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText(/connectivity test succeeded/)).toBeTruthy();

    rerender(<WebhookStatus health={failed} allowTest />);
    expect(screen.getByText("Last delivery failed")).toBeTruthy();
    expect(screen.getByText(/The receiver returned HTTP 502/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.querySelector("script")).toBeNull();
  });

  it("reveals bot instructions that do not contain secrets", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<WebhookStatus health={failed} allowTest />);
    expect(screen.queryByText(/X-Decisions-Signature/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "How a bot can set this up" }));
    const instructions = webhookSetupInstructions();
    const shown = document.querySelector("pre")?.textContent || "";
    expect(shown).toContain("X-Decisions-Signature");
    expect(shown).toContain("DECISION_WEBHOOK_URL");
    expect(shown).toContain("webhook.test");
    expect(shown).not.toContain(secret);
    expect(shown).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(shown).toBe(instructions);
    await user.click(screen.getByRole("button", { name: "Copy instructions" }));
    expect(writeText).toHaveBeenCalledWith(instructions);
    expect(writeText.mock.calls[0][0]).not.toContain(secret);
  });

  it("does not put the saved secret back into the settings form", () => {
    render(<SettingsForm areas={["Design", "Other"]} webhookUrl="https://receiver.example/hook" />);
    const secretField = screen.getByLabelText("Webhook secret") as HTMLInputElement;
    expect(secretField.type).toBe("password");
    expect(secretField.value).toBe("");
    expect(secretField.value).not.toContain(secret);
  });

  it("replaces the inbox indicator when a refresh or answer returns a new result", async () => {
    const user = userEvent.setup();
    const decision = seedDecisions().find((item) => item.options.includes("Approve it"));
    if (!decision) throw new Error("missing seed");
    const unknown: PublicWebhookHealth = {
      state: "unknown",
      source: "settings",
      detail: "A saved URL is not a working notification.",
    };
    const working: PublicWebhookHealth = {
      state: "ok",
      source: "settings",
      at: "2026-11-12T15:04:00.000Z",
      kind: "delivery",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init?: RequestInit) => {
        const health = init?.method === "PATCH" ? failed : working;
        const body =
          init?.method === "PATCH"
            ? {
                decision: {
                  ...decision,
                  status: "Answered",
                  answer: "Approve it",
                  customAnswer: "",
                  answeredAt: "2026-11-12T15:05:00.000Z",
                  revision: "next",
                },
                webhookHealth: health,
              }
            : { decisions: [decision], mode: "appwrite", webhookHealth: health };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    render(
      <Dashboard
        mode="appwrite"
        initialNow={Date.parse("2026-11-10T14:00:00Z")}
        initialDecisions={[decision]}
        webhookHealth={unknown}
      />,
    );
    expect(screen.getByText("Not verified")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh inbox" }));
    await waitFor(() => expect(screen.getByText("Working")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Approve it" }));
    await waitFor(() => expect(screen.getByText("Last delivery failed")).toBeTruthy());
  });
});
