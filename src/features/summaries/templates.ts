/**
 * Summary templates (requirement F4). All of them are generated together by the job runner,
 * so switching between them in the app needs no request. The first one is the default.
 *
 * "Catch me up" leads because AFK's user is the person who wasn't fully there: it answers
 * what changed and what needs them before the general overview.
 */
export type SummaryTemplate = {
  key: string;
  name: string;
  description: string;
  sections: ReadonlyArray<{ heading: string; guidance: string }>;
  pointsPerSection: { min: number; max: number };
};

export const SUMMARY_TEMPLATES: ReadonlyArray<SummaryTemplate> = [
  {
    key: "catch_up",
    name: "Catch me up",
    description: "For someone who missed the call: what changed and what needs them.",
    sections: [
      {
        heading: "What you missed",
        guidance:
          "The outcomes and changes a person who was absent must know, most important first.",
      },
      {
        heading: "What needs attention",
        guidance: "Commitments, requests and problems that need someone to act or respond.",
      },
      {
        heading: "Still open",
        guidance: "Questions raised but not settled, and disagreements left unresolved.",
      },
    ],
    pointsPerSection: { min: 1, max: 5 },
  },
  {
    key: "general",
    name: "General",
    description: "A balanced overview of what was discussed.",
    sections: [
      {
        heading: "Overview",
        guidance: "What the meeting was for and how it went, in plain terms.",
      },
      { heading: "Key points", guidance: "The substantive points discussed, in meeting order." },
      { heading: "Next steps", guidance: "What happens after the meeting, as agreed in it." },
    ],
    pointsPerSection: { min: 1, max: 6 },
  },
  {
    key: "project_update",
    name: "Project update",
    description: "Progress, problems and plans, as a status report.",
    sections: [
      { heading: "Progress", guidance: "Work reported as done or advanced since last time." },
      { heading: "Problems and risks", guidance: "Blockers, failures, risks and concerns raised." },
      { heading: "Plans", guidance: "Work planned next, with who is doing it when that was said." },
    ],
    pointsPerSection: { min: 1, max: 5 },
  },
  {
    key: "brief",
    name: "Brief",
    description: "Three points, for when you have thirty seconds.",
    sections: [
      {
        heading: "In three points",
        guidance: "Exactly the three things worth remembering from this meeting.",
      },
    ],
    pointsPerSection: { min: 3, max: 3 },
  },
];

export const DEFAULT_TEMPLATE_KEY = "catch_up";

export function findTemplate(key: string | null | undefined): SummaryTemplate | undefined {
  return SUMMARY_TEMPLATES.find((template) => template.key === key);
}
