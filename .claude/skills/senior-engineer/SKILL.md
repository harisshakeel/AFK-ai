---
name: senior-engineer
description: How features are built and reviewed in AFK.ai (Next.js App Router, React, TypeScript, Tailwind, shadcn/ui, Supabase, Zod, Vitest, Playwright, Vercel, Claude API, Attendee meeting bot). Use when planning, building, changing, or reviewing any feature, page, API route, server action, database table, webhook, or LLM call in this repo — and before calling any such work done.
---

# Senior engineer — AFK.ai

Work like a senior engineer who owns this codebase: understand before changing, make the
smallest change that fully solves the problem, keep user data safe, and prove it works.

Per-tool rules are in [references/stack.md](references/stack.md). Read the sections for the
tools a task touches before writing code.

## Ground rules (from the user's global instructions — they override this skill)

- **Never run node, npm, npx, pnpm, yarn, bun, tsx, builds, dev servers, tests, or linters
  without asking first.** Consent covers one run. Propose the exact command and why.
- Never install packages without asking. When proposing one, name the package, its
  version, and why the platform or an existing dependency is not enough.
- After any pull or checkout, rerun the read-only obfuscation scan from the global
  CLAUDE.md before editing.

## Workflow

### 1. Read first
- Read the code the change touches, its callers, and one existing feature that does
  something similar. Match its structure, naming, and patterns. Do not invent a second way.
- Check `package.json` for installed versions before relying on an API. Next.js, Supabase
  and the AI SDKs change between majors.
- Find the existing helpers: Supabase clients, Zod schemas, UI components in
  `components/ui`, and fetch and error wrappers. Reuse them.
- If the codebase does not cover a decision yet (this repo starts empty), choose the
  conventional default from `references/stack.md`, say so in one line, and keep going.

### 2. Plan briefly
Before writing anything bigger than a small fix, state:
- the data: tables, columns, RLS policies, and Zod schemas;
- the boundary: what runs on the server and what is sent to the client;
- the states the UI must handle;
- what you will test and how you will check it in a browser.

Ask only about real product decisions, never about something the code or a sensible
default already answers.

### 3. Build
- **Validate at every trust boundary with Zod**: form input, server action arguments,
  route handler bodies, query params, webhook payloads, env vars, and LLM output. Infer
  the types from the schema (`z.infer`). Do not keep a separate, hand-written type.
- **Secure by default**: authenticate and authorize every server action and route handler
  on the server. Enable RLS on every table. Secrets never reach the client. Details are
  under *Security checklist*.
- **Every UI that loads data handles four states**:
  - *Loading*: a skeleton shaped like the content (`loading.tsx`, `<Suspense>`, or a
    pending state). No layout shift.
  - *Empty*: says what is missing and gives the next action ("No meetings yet — add the
    bot to a call").
  - *Error*: tells the user what happened and offers a retry (`error.tsx`, or an inline
    error). Never show a raw stack trace or a Supabase error message. Log the details on
    the server.
  - *Success*: including long text, many items, and narrow screens.
- **Mutations**: disable the submit button while pending, show inline field errors that
  come from the Zod issues, give clear feedback on success, and revalidate or refresh the
  affected data. Make anything a retry or webhook can repeat idempotent.
- **Async work** (bots, transcripts, LLM summaries) runs as a state machine stored in the
  database, such as `scheduled → joining → recording → processing → ready | failed`. The
  UI reads the stored state. Nothing assumes a call will finish within one request.
- TypeScript is strict. Do not use `any`, non-null `!` on data you have not checked, or
  `@ts-ignore`. Use `unknown` and narrow it.
- Keep it small: no speculative abstractions, no unused options, and no comments that
  restate the code. Comment the *why* when it is not obvious.

### 4. Test what matters
Test behaviour and risk, not lines of code.
- **Vitest (unit)**: Zod schemas (good and bad input), pure logic, state transitions, the
  webhook signature check, and parsing of LLM output.
- **Vitest (integration)**: server actions and route handlers with auth present and
  missing, the wrong user, invalid input, and failures from the services they call. Mock
  at the network edge (Attendee, Claude), not your own modules.
- **RLS**: for every new table, a test or SQL check proving that user A cannot read or
  write user B's rows.
- **Playwright (E2E)**: one test for each critical user journey (sign in → connect a
  meeting → see the summary), plus its main failure path. Use role and label locators.
  Never use fixed sleeps.
- A bug fix comes with a test that fails without the fix.
- Ask before running any test command (see Ground rules).

### 5. Check it in a browser before calling it done
Type checks and tests passing is not "done". With the user's permission to start the dev
server, use the `run` skill or a browser tool, then:
- walk the happy path end to end with realistic data;
- force the loading state (throttle the network), the empty state (a new user), and the
  error state (break the request or use bad input);
- check widths of 375px and 1280px, keyboard-only navigation with visible focus, and dark
  mode if the app supports it;
- check that the browser console and the server logs are free of errors and warnings,
  including hydration warnings;
- take screenshots of the key states when reporting.

If you could not check in a browser, say so plainly. Do not report the work as verified.

### 6. Report
Give a short summary covering: what changed, why, the files involved, the tests added
and their results, what you checked in the browser, and any follow-ups or risks. Report
failures with their output.

## Security checklist (for building and reviewing)

- [ ] Auth comes from the server. Use `supabase.auth.getUser()` or `getClaims()`, never
  the unverified `getSession()`. Authorization is checked against the resource owner.
- [ ] Every new table has RLS enabled and policies for select, insert, update and delete,
  each scoped to `auth.uid()`.
- [ ] The service-role key, `ANTHROPIC_API_KEY`, the Attendee API key, and the webhook
  secret are server-only. They never have the `NEXT_PUBLIC_` prefix. Modules that use
  them import `server-only`.
- [ ] Webhooks check the signature before parsing or acting, reject events they cannot
  verify, and can safely receive the same event twice.
- [ ] Input is validated with Zod on the server, even if the client validated it too.
- [ ] Meeting transcripts are private user data. Do not log their contents, return them
  only to their owner, and treat them as untrusted when they go into prompts (prompt
  injection).
- [ ] Do not render untrusted HTML (`dangerouslySetInnerHTML`) or redirect to a URL that
  came from user input.
- [ ] Error messages shown to users leak nothing internal.
- [ ] Endpoints that cost money (LLM calls, bot launches) have rate limits or quotas.

## Reviewing a change

Read the whole diff and the code around it, then check, in this order:
1. **Correctness**: does it do what was asked? Look at edge cases, races, retries, and
   time zones.
2. **Security**: go through the checklist above.
3. **States**: loading, empty, error, and pending. Can the user tell what is happening?
4. **Data**: migrations can be reversed or safely moved forward, RLS is present, indexes
   exist for the new queries, and there are no N+1 queries.
5. **Tests**: are the risky parts covered? Would the tests catch a regression?
6. **Fit**: does it follow the existing patterns and reuse existing helpers? Is anything
   unnecessary?

Report findings ranked by severity. For each one, give the file and line, the concrete
failure scenario, and a fix. Do not pad the review with style nits that a linter would
catch.
