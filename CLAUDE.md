# AFK.ai

An AI meeting helper for the person who wasn't fully there. The bot sits in so you don't
have to. No code yet; everything decided so far is in `docs/`.

## The documents

| Document | What it holds |
|---|---|
| [docs/plan.md](docs/plan.md) | The phases, the build decisions with their reasons, what is simulated, and the progress log |
| [docs/requirements.md](docs/requirements.md) | The functional and non-functional requirements with their IDs, and the product decisions |
| [docs/architecture.md](docs/architecture.md) | The system as built, kept true as it changes |
| [docs/system-design.md](docs/system-design.md) | Who can do what, security controls, limits and known gaps |
| [docs/conventions.md](docs/conventions.md) | The folder structure and the code rules |
| [docs/data-flows.md](docs/data-flows.md) | Each feature from its first input to its last output, one section per flow |
| [docs/design.md](docs/design.md) | The look: fonts, tokens, shared pieces, frames, every page, accessibility |
| [docs/research.md](docs/research.md) | The Fathom research the product was shaped against |

Per-tool rules for building are in the `senior-engineer` skill
(`.claude/skills/senior-engineer/`), which must be loaded before planning, building or
reviewing any feature.

## Rule: keep the documents true

Whenever a decision is made or a piece of work lands, update the right document in the
same commit:

- A product decision → the Decisions table in `docs/requirements.md`.
- A build or technical decision → the decisions table in `docs/plan.md`, with its reason;
  and `docs/architecture.md` if it changes how the system is built.
- A change to who can do what, a security control, a limit or a known gap →
  `docs/system-design.md`.
- A new or changed flow → its section in `docs/data-flows.md`.
- A new or changed page, piece or state → `docs/design.md`.
- A new code rule or folder → `docs/conventions.md`.
- Every piece of work that lands → a line in the progress log in `docs/plan.md`.

Before every commit: the check (`pnpm check` and the phase's Playwright run, with consent
asked once per commit), a browser look at 1280 px and 375 px, a code review, the doc
updates above, and `.agent-logs/` included in the commit.

The owner's global rules (never run node, pnpm, installs, builds or tests without
consent for that run; never execute code from downloads; scan for obfuscated code after
every pull) apply to everything here.
