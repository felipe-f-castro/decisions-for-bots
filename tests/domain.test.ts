import { describe, expect, it } from "vitest";
import {
  AppError,
  parseStatus,
  validateDecisionId,
  applyMutation,
  parseMutation,
  parseNewDecision,
  parseAreas,
  areaTone,
  AREAS,
  sortOpen,
} from "@/lib/domain";
import { seedDecisions } from "@/lib/seed";
import { deadlineLabel, fullDate, isUrgent, saoPauloToISO } from "@/lib/time";

const [group, images, custom, interview] = seedDecisions();
const now = new Date("2026-11-10T14:00:00Z");
const validInput = {
  question: "  Next move?  ",
  context: "Some context",
  options: ["First", "Second"],
  area: "Other",
  waitingOn: "Assistant",
  deadline: null,
};

describe("decision transitions", () => {
  it("keeps options scoped to their own decision", () => {
    expect(() =>
      applyMutation(
        group,
        {
          action: "answer",
          answer: images.options[0],
          custom: false,
          expectedRevision: group.revision,
        },
        now,
      ),
    ).toThrow("does not belong");
    const answered = applyMutation(
      images,
      { action: "answer", answer: "Approve it", custom: false, expectedRevision: images.revision },
      now,
    );
    expect(answered).toMatchObject({
      status: "Answered",
      answer: "Approve it",
      customAnswer: "",
      answeredAt: now.toISOString(),
    });
    expect(images.status).toBe("Open");
  });
  it("accepts a custom answer even with no predefined options", () => {
    const answered = applyMutation(
      custom,
      {
        action: "answer",
        answer: "Spring release",
        custom: true,
        expectedRevision: custom.revision,
      },
      now,
    );
    expect(answered.answer).toBe("Spring release");
    expect(answered.customAnswer).toBe(answered.answer);
  });
  it("allows changes while Answered and clears the previous custom answer", () => {
    const first = applyMutation(
      images,
      { action: "answer", answer: "Maybe five", custom: true, expectedRevision: images.revision },
      now,
    );
    const changed = applyMutation(
      first,
      { action: "answer", answer: "Revise it", custom: false, expectedRevision: first.revision },
      now,
    );
    expect(changed).toMatchObject({ answer: "Revise it", customAnswer: "", status: "Answered" });
    expect(changed.revision).not.toBe(first.revision);
  });
  it("undo clears all answer properties", () => {
    const first = applyMutation(
      images,
      { action: "answer", answer: "Approve it", custom: false, expectedRevision: images.revision },
      now,
    );
    expect(
      applyMutation(first, { action: "reopen", expectedRevision: first.revision }, now),
    ).toMatchObject({ status: "Open", answer: "", customAnswer: "", answeredAt: null });
  });
  it("rejects a stale undo rather than overwriting a newer answer", () => {
    const first = applyMutation(
      images,
      { action: "answer", answer: "Approve it", custom: false, expectedRevision: images.revision },
      now,
    );
    const changed = applyMutation(
      first,
      { action: "answer", answer: "Revise it", custom: false, expectedRevision: first.revision },
      now,
    );
    expect(() =>
      applyMutation(changed, { action: "reopen", expectedRevision: first.revision }, now),
    ).toThrow("decision changed");
  });
  it("only routes answered decisions and preserves the saved answer", () => {
    expect(() =>
      applyMutation(images, { action: "route", expectedRevision: images.revision }, now),
    ).toThrow("Only an answered");
    const first = applyMutation(
      images,
      { action: "answer", answer: "Approve it", custom: false, expectedRevision: images.revision },
      now,
    );
    const routed = applyMutation(first, { action: "route", expectedRevision: first.revision }, now);
    expect(routed).toMatchObject({
      status: "Routed",
      answer: "Approve it",
      answeredAt: first.answeredAt,
    });
    for (const mutation of [
      { action: "reopen" as const, expectedRevision: routed.revision },
      {
        action: "answer" as const,
        answer: "Revise it",
        custom: false,
        expectedRevision: routed.revision,
      },
    ]) {
      try {
        applyMutation(routed, mutation, now);
        throw new Error("Should be locked");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(409);
      }
    }
  });
});

describe("input boundaries and ordering", () => {
  it("normalizes input and deadline offsets", () => {
    expect(
      parseNewDecision({ ...validInput, deadline: "2026-11-12T07:24:00-03:00" }),
    ).toMatchObject({ question: "Next move?", deadline: "2026-11-12T10:24:00.000Z" });
    expect(parseNewDecision({ ...validInput, options: [] }).options).toEqual([]);
  });
  it.each([
    { ...validInput, question: " " },
    { ...validInput, area: "Anything" },
    { ...validInput, options: ["One", "One"] },
    { ...validInput, options: ["Two\nlines"] },
    { ...validInput, options: Array.from({ length: 21 }, (_, i) => `Option ${i}`) },
    { ...validInput, options: ["x".repeat(201)] },
    { ...validInput, deadline: "2026-11-12T07:24" },
    { ...validInput, deadline: "invalid" },
    null,
  ])("rejects invalid decision input %#", (input) =>
    expect(() => parseNewDecision(input)).toThrow(AppError),
  );
  it("validates and deduplicates image URLs without allowing script or credential URLs", () => {
    expect(
      parseNewDecision({
        ...validInput,
        imageUrls: ["https://example.com/a.png", "https://example.com/a.png"],
      }).imageUrls,
    ).toEqual(["https://example.com/a.png"]);
    for (const imageUrls of [
      ["javascript:alert(1)"],
      ["data:image/png;base64,test"],
      ["https://user:secret@example.com/a.png"],
      ["/relative.png"],
      [42],
      Array(11).fill("https://example.com/a.png"),
    ])
      expect(() => parseNewDecision({ ...validInput, imageUrls })).toThrow(AppError);
    expect(parseStatus("Answered")).toBe("Answered");
    expect(() => parseStatus("unknown")).toThrow(AppError);
    expect(validateDecisionId(group.id)).toBe(group.id);
    expect(() => validateDecisionId("rec12345678901234")).toThrow(AppError);
    expect(() => validateDecisionId("../tables")).toThrow(AppError);
  });
  it("requires a revision and explicit custom flag on answers", () => {
    expect(() => parseMutation({ action: "answer", answer: "First", custom: false })).toThrow();
    expect(() =>
      parseMutation({ action: "answer", answer: "First", expectedRevision: images.revision }),
    ).toThrow();
    expect(() =>
      parseMutation({
        action: "answer",
        answer: " ",
        custom: true,
        expectedRevision: images.revision,
      }),
    ).toThrow();
    expect(() => parseMutation({ action: "unknown", expectedRevision: images.revision })).toThrow();
  });
  it("sorts deadlines first, then oldest, without mutating the original array", () => {
    const list = [images, interview, group, { ...custom, deadline: "2026-11-11T10:00:00Z" }];
    expect(sortOpen(list).map((d) => d.id)).toEqual([custom.id, interview.id, group.id, images.id]);
    expect(list[0].id).toBe(images.id);
  });
});

describe("São Paulo times", () => {
  it("converts wall-clock deadlines independently of the system timezone", () => {
    expect(saoPauloToISO("2026-11-12T07:24")).toBe("2026-11-12T10:24:00.000Z");
    expect(saoPauloToISO("")).toBeNull();
    expect(fullDate("2026-11-12T10:24:00Z")).toContain("7:24 AM");
  });
  it("warns within 48 hours and keeps overdue deadlines urgent", () => {
    expect(isUrgent("2026-11-12T14:00:00Z", now.getTime())).toBe(true);
    expect(isUrgent("2026-11-12T14:00:01Z", now.getTime())).toBe(false);
    expect(isUrgent(null, now.getTime())).toBe(false);
    expect(deadlineLabel("2026-11-09T14:00:00Z", now.getTime())).toBe("Overdue");
  });
});

describe("configurable areas", () => {
  it("defaults to Design, Content, Other when unset or empty", () => {
    expect(parseAreas(undefined)).toEqual(["Design", "Content", "Other"]);
    expect(parseAreas("")).toEqual(["Design", "Content", "Other"]);
    expect(parseAreas(" , ,")).toEqual(["Design", "Content", "Other"]);
    expect(AREAS).toEqual(["Design", "Content", "Other"]);
  });

  it("parses a custom list, trimming and removing duplicates", () => {
    expect(parseAreas(" Jobs, Elus Food ,Other,jobs,")).toEqual(["Jobs", "Elus Food", "Other"]);
  });

  it("rejects names over 40 characters and more than 12 areas", () => {
    expect(() => parseAreas("x".repeat(41))).toThrow(/longer than 40/);
    expect(parseAreas("x".repeat(40))).toEqual(["x".repeat(40)]);
    const thirteen = Array.from({ length: 13 }, (_, i) => `Area ${i}`).join(",");
    expect(() => parseAreas(thirteen)).toThrow(/at most 12/);
  });

  it("validates decisions against the configured areas", () => {
    const areas = parseAreas("Jobs,Elus Food,Other");
    expect(parseNewDecision({ ...validInput, area: " Elus Food " }, areas).area).toBe("Elus Food");
    expect(() => parseNewDecision({ ...validInput, area: "Design" }, areas)).toThrow(
      "Choose Jobs, Elus Food, or Other.",
    );
    expect(() => parseNewDecision({ ...validInput, area: "Design" }, ["Jobs", "Other"])).toThrow(
      "Choose Jobs or Other.",
    );
    expect(() => parseNewDecision({ ...validInput, area: 3 })).toThrow(
      "Choose Design, Content, or Other.",
    );
  });

  it("gives unknown areas a stable generic tone", () => {
    expect(areaTone("Design")).toBe("design");
    expect(areaTone("Elus Food")).toMatch(/^tone-[0-3]$/);
    expect(areaTone("Elus Food")).toBe(areaTone("elus food"));
  });
});
