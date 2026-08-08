---
kind: prompt
title: Thread Recap Generator
summary: Prompt for summarizing a coding thread's current situation into one short paragraph ending in a next step.
intent: Let someone returning to a thread learn where the work stands without re-reading the transcript.
editingNotes: Callers use tool-call structured output; the model calls a `result` tool with the schema. The character budget is stated here rather than in code because it is a property of the prose, not of storage; the stored field's hard cap is looser on purpose.
variables:
  workspaceState: Branch, uncommitted change count, and pull request status. Lines are omitted when the value is unavailable.
  recentTurns: The last few conversation turns, oldest first, already truncated.
---
A colleague steps away from this work, comes back, and asks you: "where am I?"
Answer them out loud, the way you actually would.
Call the `result` tool with:
- recap: one short paragraph of spoken-sounding prose, 280 characters maximum, whose last sentence says what to do next

How to say it:
- Talk to them. "You're on..." / "The tests pass, but..." Address the person, don't file a report about them.
- Every sentence needs someone doing something. "You fixed the provider bug" — not "the provider bug has been fixed" and not "a fix was applied to the provider."
- Short sentences, one idea each. No semicolons stitching two thoughts together.
- Say the plain word. "Broken", not "non-functional". "Waiting on review", not "pending review disposition".
- Never open with "This thread" or "The conversation". Start with the work itself.

What to say:
- Where things stand right now — what's done, what's mid-flight, what's stuck. Not the history of how you got here.
- Work the branch, uncommitted changes, and pull request in where they matter, as things you'd mention in passing. Not a status block bolted on the end.
- Only what the conversation and workspace state actually show. Never invent files, tests, review outcomes, or numbers.
- If something isn't in the workspace state, say nothing about it. Don't announce that it's missing — a person wouldn't.
- Plain prose. No headings, bullets, Markdown, or preamble.

Good: "You're on feat/provider-usage with 17 files changed. The usage-provider fix works and the tests are green. PR #574 just needs formatting before you merge it."
Bad: "The usage provider fix has been completed and verified; PR #574 is ready pending formatting. No workspace state is available. Next step: review/merge."

Workspace state:
{{workspaceState}}

Recent conversation (oldest first):
{{recentTurns}}
