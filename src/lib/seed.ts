import type { Decision } from "./domain";

export function seedDecisions(): Decision[] {
  const common = {
    status: "Open" as const,
    answer: "",
    customAnswer: "",
    answeredAt: null,
    deadline: null,
    images: [],
    updatedAt: "2026-11-10T09:00:00.000Z",
  };
  return [
    {
      ...common,
      id: "11111111-1111-4111-8111-111111111111",
      question: "Which logo should we use?",
      context:
        "Two directions for the new project. Pick the one you’d like the design assistant to refine.",
      area: "Design",
      waitingOn: "Design assistant",
      options: ["Rounded mark", "Geometric mark"],
      images: [
        {
          id: "rounded",
          url: "/demo/rounded.svg",
          thumbnailUrl: "/demo/rounded.svg",
          filename: "Rounded mark",
        },
        {
          id: "geometric",
          url: "/demo/geometric.svg",
          thumbnailUrl: "/demo/geometric.svg",
          filename: "Geometric mark",
        },
      ],
      createdAt: "2026-11-09T12:00:00.000Z",
      revision: "seed-logo-v1",
    },
    {
      ...common,
      id: "22222222-2222-4222-8222-222222222222",
      question: "Approve the newsletter draft?",
      context: "The next issue is ready. It introduces this month’s updates and a short tutorial.",
      area: "Content",
      waitingOn: "Writing assistant",
      options: ["Approve it", "Revise it"],
      createdAt: "2026-11-09T13:00:00.000Z",
      revision: "seed-newsletter-v1",
    },
    {
      ...common,
      id: "33333333-3333-4333-8333-333333333333",
      question: "What should we name the next release?",
      context:
        "A fresh start deserves a good name. Give the release assistant a direction to work with.",
      area: "Content",
      waitingOn: "Release assistant",
      options: [],
      createdAt: "2026-11-09T14:00:00.000Z",
      revision: "seed-release-v1",
    },
    {
      ...common,
      id: "44444444-4444-4444-8444-444444444444",
      question: "When should we schedule the team workshop?",
      context:
        "A one-hour planning workshop. Choose a slot so the scheduling assistant can prepare an invitation.",
      area: "Other",
      waitingOn: "Scheduling assistant",
      deadline: "2026-11-12T15:00:00.000Z",
      options: ["Tuesday morning", "Thursday afternoon", "Next week"],
      createdAt: "2026-11-10T09:00:00.000Z",
      revision: "seed-workshop-v1",
    },
  ];
}
