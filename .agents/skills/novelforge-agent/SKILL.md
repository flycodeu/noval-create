---
name: novelforge-agent
description: Operate NovelForge through its MCP tools for project discovery, context inspection, dynamic character-cast planning, model-backed draft generation, quality review, safe writeback, run tracking, and recommendation preflight. Use when an agent must create, inspect, review, optimize, or record novel assets in NovelForge; do not use for unrelated source-code maintenance.
---

# NovelForge Agent

Use the `novelforge` MCP server as the source of truth. Do not bypass tool contracts by editing its SQLite database.

## Start every workflow

1. Call `novelforge.capabilities.list` when the available tool set is not already known. Filter by domain or search text instead of assuming a tool exists.
2. Call `novelforge.projects.list`, select the project explicitly, then call `novelforge.projects.get`.
3. Preserve the returned `contextVersion`. Re-read context before any later canonical write if that version may have changed.
4. Inspect the relevant existing assets before proposing additions. For cast work, call `novelforge.characters.list`.

## Plan the cast

1. Call `novelforge.characters.analyze_needs` before generating multiple characters.
2. Set a bounded scope and `maxNewCharacters`; pass user goals as evidence-oriented goals, not a fixed target count.
3. Prefer `review_first` for important projects, `balanced` for routine planning, and `fast` only when deterministic review is sufficient.
4. Treat the genre/length `priorRange` as a safety range, never as a quota.
5. Inspect `roleSlots`, `existingActions`, `mergeGroups`, `deterministicChecks`, and `review`.
6. Stop when `review.status` is `blocked`. Resolve every hard blocker or ask the user for the missing decision.
7. When status is `needs_revision`, use `revisionSuggestions` to tighten constraints and rerun analysis. Do not silently accept the plan.
8. Report `planId`, `taskId`, `reviewTaskId`, suggested create/merge/archive counts, review score, blockers, warnings, and assumptions.

## Generate, review, and write back

Discover the current draft/review/commit tools at runtime. Follow this order whenever those tools are available:

1. Analyze needs with `novelforge.characters.analyze_needs`; its `planId` is a persisted immutable artifact.
2. Generate a draft with `novelforge.characters.generate_draft` and a unique `idempotencyKey`.
3. Inspect the returned independent review. Use `novelforge.characters.review` when a fresh deterministic recheck is needed.
4. Revise until hard blockers are cleared or the user stops.
5. Show a concise diff and request explicit user approval.
6. Call a canonical-write tool only with the expected context version and approval required by its contract.
7. Use `novelforge.artifacts.get` for full content and `novelforge.artifacts.list` for compact history. Read the resulting run with `novelforge.runs.get` and report the recorded outcome.
8. Use `novelforge.audit.query` to verify the write, approval reference, actor, hashes, and status.

Never treat a draft as canonical. Never infer approval from a prior unrelated instruction. Never retry non-idempotent tools blindly.

External MCP sessions have no canonical-write scopes by default. Do not ask for broader scopes unless the user explicitly wants a write. A configured MCP approval token is a trusted operator session grant, not permission inferred from conversation text.

## Draft other novel assets

For world rules, outlines, chapters, project briefs, theme/voice, factions, items, threads, timelines, subplots, maps, or a bounded single-character draft:

1. Call `novelforge.assets.generate_draft` with a precise title, bounded requirements, the desired output format, and a unique idempotency key.
2. Read full content through `novelforge.artifacts.get`; tool results intentionally return only a preview and compact artifact references.
3. Inspect `review.status`, deterministic `checks`, `hardBlockers`, `warnings`, and `readyForHumanApply`. A model-review outage is `needs_revision`, never an implicit pass.
4. Call `novelforge.assets.review_draft` with a new idempotency key when an independent current-context review or optimization is needed. If rewritten, use the returned `effectiveArtifact`; the source remains immutable and is marked superseded only after a non-blocked revision exists.
5. Present the reviewed result to the author in the existing NovelForge workflow. These generic tools do not apply content to canonical tables.

Use JSON plus a concrete `schemaHint` for structured assets. Use Markdown or text for author-facing prose. Never parse `outputPreview` as the complete asset.

## Handle recommendation evaluation

When recommendation tools are present:

1. Read `novelforge.recommendation.get_workspace` before any action so the attempt state, latest preflight, and latest locked candidate can be recovered together.
2. Run internal preflight freely; it must not consume a platform evaluation attempt.
3. Lock one candidate snapshot only after preflight passes and the user accepts the exact version.
4. Record a real author/platform evaluation result only after the user confirms it actually occurred.
5. Never fabricate, overwrite, delete, or merge attempt history.
6. Treat the configured platform rule as a hard gate: at most three evaluations in total; three failed evaluations lock serializing works, while one failed evaluation locks completed works.

## Review and repair novel quality

1. Call `novelforge.quality.run_evaluation` with `longform_health_v1` during normal iteration. Use `recommendation_ready_v1` only for the stricter internal gate before recommendation preflight.
2. For novel or volume scope, call `novelforge.quality.run_semantic_evaluation` on the fresh deterministic report when causality, character arcs, theme progression, world consistency, foreshadow payoff, or pacing need cross-chapter evidence. Use the enriched report for repair planning. Strict recommendation preflight must not ignore failed windows, rejected evidence, or incomplete coverage.
3. Treat the returned report as an immutable internal artifact, never as a real platform evaluation or a promise that an external detector will pass. Read the complete report with `novelforge.artifacts.get` when the compact tool result is insufficient.
4. Stop claiming readiness when `status` is `blocked`. Resolve evidence-backed `blocking=true` findings first; for `needs_revision`, prioritize critical and recurring findings before cosmetic language work.
5. Call `novelforge.quality.propose_repairs` only while the report Context Version is current. If it returns `QUALITY_REPORT_STALE`, rerun evaluation with a new idempotency key instead of planning from old evidence.
6. Inspect repair dependencies, affected chapters, acceptance criteria, and regression guards. A repair plan is a draft artifact: it never authorizes canonical writes or external submissions.
7. For chapter-targeted items, call `novelforge.quality.apply_repair_draft` in batches of at most three chapters, then read the full original/optimized text and guards with `novelforge.artifacts.get`. Use generic draft tools for global items without chapter evidence. Never treat `canonicalWriteAllowed=false` as an apply action.
8. Call `novelforge.quality.review_repair_draft` before presenting a candidate as acceptable. It creates a separate low-variance model Task, requires evidence for every acceptance criterion and regression guard, and fails closed on missing evidence, stale context, hash mismatch, unsafe deterministic gates, or critical semantic regression. Read the complete review artifact when the compact result is insufficient.
9. Only after the independent review passes may the author inspect and apply the Diff through the existing NovelForge UI. Then rerun `novelforge.quality.run_evaluation` with the old report as `baselineReportArtifactId` and a new idempotency key.
10. Call `novelforge.quality.compare_runs`. Do not accept a revision when it introduces blockers, lowers coverage/confidence, mixes incompatible profiles/scopes, or reports regression. Repeat the draft/review loop or hand off for human judgment.
11. Internal quality runs and comparisons never consume recommendation attempts. Continue to use recommendation workspace/preflight/candidate tools for the separate three-attempt governance workflow.

## Respect contracts

- Use only fields declared by each tool's `inputSchema`.
- Treat `effect`, `approval`, `scopes`, `idempotent`, and `taskMode` as operational policy, not descriptive prose.
- Keep model keys inside NovelForge; let NovelForge route its configured generation/review models.
- Distinguish model quality failure from transport failure. Retry only when the error is marked retryable or the tool is idempotent.
- Prefer structured result fields over parsing display text.
