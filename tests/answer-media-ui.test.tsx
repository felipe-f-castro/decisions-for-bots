// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnsweredCard, DecisionCard } from "@/components/decision-card";
import { seedDecisions } from "@/lib/seed";
import type { Decision } from "@/lib/domain";

const [open] = seedDecisions();
const now = Date.parse("2026-11-12T12:00:00Z");

describe("answer media controls", () => {
  afterEach(() => cleanup());

  it("shows image, upload, and record controls on an open card", () => {
    render(
      <DecisionCard decision={open} busy={false} now={now} onAnswer={vi.fn(async () => true)} />,
    );
    expect(screen.getByLabelText("Add image").getAttribute("type")).toBe("file");
    expect(screen.getByLabelText("Upload audio").getAttribute("accept")).toContain("audio/webm");
    expect(screen.getByRole("button", { name: "Record audio" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("shows the image and an audio player after the answer is saved", () => {
    const answered: Decision = {
      ...open,
      status: "Answered",
      answer: "",
      customAnswer: "",
      answeredAt: "2026-11-12T12:00:00.000Z",
      answerMedia: [
        {
          id: "11111111-1111-4111-8111-111111111112",
          kind: "image",
          url: "/api/decisions/x/media/image",
          thumbnailUrl: "/api/decisions/x/media/image",
          filename: "shot.png",
          contentType: "image/png",
          alt: "The chosen logo",
          durationSeconds: null,
        },
        {
          id: "11111111-1111-4111-8111-111111111113",
          kind: "audio",
          url: "/api/decisions/x/media/audio",
          thumbnailUrl: "",
          filename: "reply.webm",
          contentType: "audio/webm",
          alt: "",
          durationSeconds: 75,
        },
      ],
    };
    render(<AnsweredCard decision={answered} busy={false} onAnswer={vi.fn(async () => true)} />);
    expect(screen.getByText("Image and audio reply")).toBeTruthy();
    expect(screen.getByRole("img", { name: "The chosen logo" }).getAttribute("src")).toContain(
      "/media/image",
    );
    const player = document.querySelector("audio");
    expect(player?.hasAttribute("controls")).toBe(true);
    expect(player?.getAttribute("src")).toBe("/api/decisions/x/media/audio");
    expect(screen.getByText("1:15")).toBeTruthy();
  });

  it("can send a media-only custom answer from the selected file", async () => {
    const onAnswer = vi.fn(async () => true);
    render(<DecisionCard decision={open} busy={false} now={now} onAnswer={onAnswer} />);
    const file = new File([Uint8Array.from([1, 2, 3])], "note.webm", { type: "audio/webm" });
    await userEvent.upload(screen.getByLabelText("Upload audio"), file);
    expect(screen.getByText("Audio attached")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: `Send custom answer for ${open.question}` }),
    );
    expect(onAnswer).toHaveBeenCalledWith(
      open,
      expect.objectContaining({ text: "", custom: true, audio: file, image: null }),
    );
  });
});
