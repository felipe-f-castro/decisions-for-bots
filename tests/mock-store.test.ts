import { describe, expect, it } from "vitest";
import { MockStore } from "@/lib/stores/mock";
import { parseNewDecision } from "@/lib/domain";

describe("in-memory store", () => {
  it("starts with the four generic questions and independent option lists", async () => {
    const list = await new MockStore().list();
    expect(list).toHaveLength(4);
    expect(list.find((d) => d.question.startsWith("What should we name"))?.options).toEqual([]);
    expect(list.find((d) => d.area === "Other")).toMatchObject({
      waitingOn: "Scheduling assistant",
      deadline: "2026-11-12T15:00:00.000Z",
    });
  });
  it("returns copies so callers cannot accidentally mutate stored decisions", async () => {
    const store = new MockStore();
    const [decision] = await store.list();
    decision.options.push("Leaked option");
    decision.question = "Changed";
    expect((await store.get(decision.id)).question).not.toBe("Changed");
    expect((await store.get(decision.id)).options).not.toContain("Leaked option");
  });
  it("creates an open decision without changing other store instances", async () => {
    const store = new MockStore([]);
    const input = parseNewDecision({
      question: "Launch?",
      area: "Other",
      options: ["Yes", "Later"],
    });
    const created = await store.create(input);
    input.options.push("Never");
    expect(created).toMatchObject({
      status: "Open",
      answer: "",
      answeredAt: null,
      options: ["Yes", "Later"],
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await new MockStore([]).list()).toEqual([]);
  });
  it("only accepts one of two concurrent writes with the same revision", async () => {
    const store = new MockStore();
    const [decision] = await store.list();
    const results = await Promise.allSettled(
      decision.options.map((answer) =>
        store.mutate(decision.id, {
          action: "answer",
          answer,
          custom: false,
          expectedRevision: decision.revision,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("returns a 404 for unknown IDs", async () => {
    await expect(new MockStore().get("missing")).rejects.toMatchObject({ status: 404 });
  });
});
