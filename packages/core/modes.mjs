// The stances an agent can be asked to work in.
//
// Orthogonal to authority (Implement / Ship / Operate, which lives in AGENTS.md):
// a mode changes what a good answer looks like, never what you may do.
export const MODES = [
  {
    id: "engineering",
    label: "Engineering",
    optimises: "correctness",
    contract: [
      "the smallest diff that does the job",
      "say what changed and why, in one pass",
      "report what you ran, and what you did not run",
    ],
    evidence: "tests, and their names",
  },
  {
    id: "art",
    label: "Art",
    optimises: "how it feels",
    contract: [
      "the owner owns taste; do not argue it twice",
      "translate the feeling into a number, in one schedule block",
      "show frames at named beats, and state the total length",
    ],
    evidence: "frames at named timestamps",
  },
  {
    id: "cto",
    label: "CTO",
    optimises: "a decision",
    contract: [
      "the recommendation in one line, first",
      "the tradeoff and the cost, plainly",
      "then stop; no implementation unless asked",
    ],
    evidence: "the risk and the fallback",
  },
  {
    id: "product",
    label: "Product",
    optimises: "what, and for whom",
    contract: [
      "name the user and the problem",
      "draw the scope edge: what this does not do",
      "acceptance in the user's terms, not the code's",
    ],
    evidence: "the acceptance the owner would recognise",
  },
  {
    id: "incident",
    label: "Incident",
    optimises: "restoring service",
    contract: [
      "the smallest safe action first",
      "say what you touched, and what is still degraded",
      "document after, not during; speed outranks elegance here only",
    ],
    evidence: "what changed, and what still hurts",
  },
  {
    id: "research",
    label: "Research",
    optimises: "knowing",
    contract: [
      "inspect and compare; change nothing",
      "a recommendation at the end, with its sources",
      "name what would prove you wrong",
    ],
    evidence: "sources, and the falsifier",
  },
];

/** Pure: an unknown id is engineering, never a phantom mode. */
export function modeById(id) {
  const wanted = String(id ?? "").trim().toLowerCase();
  return MODES.find((mode) => mode.id === wanted) ?? MODES[0];
}

/** Pure: the block an agent reads before its task. */
export function modeBlock(mode = MODES[0]) {
  const lines = [
    `${mode.label.toLowerCase()} mode — optimises ${mode.optimises}`,
    ...mode.contract.map((line) => `- ${line}`),
    `evidence: ${mode.evidence}`,
    "a mode never widens authority.",
  ];
  return lines.join("\n");
}
