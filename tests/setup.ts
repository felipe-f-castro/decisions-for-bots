import { vi } from "vitest";

// Next supplies this marker at build time. Vitest executes server modules in Node.
vi.mock("server-only", () => ({}));

// Areas come from the environment; tests assert the documented default.
delete process.env.NEXT_PUBLIC_DECISION_AREAS;
