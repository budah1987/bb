---
title: Pull Request Metadata Generator
summary: Generate an accurate pull request title and description from a branch diff.
intent: Produce concise, editable GitHub pull request metadata without inventing details.
kind: prompt
variables:
  baseBranch: Pull request base branch.
  fallbackTitle: Existing thread title for additional intent context.
  shortstat: Git shortstat summary for committed branch changes.
  files: Git name-status output for committed branch changes.
  patch: Trimmed patch excerpt for additional context.
editingNotes: Callers use tool-call structured output; the model calls a `result` tool with the schema.
---
Create metadata for a pull request into `{{baseBranch}}`.
Call the `result` tool with:
- title: a clear, specific title in sentence case, 72 characters maximum
- body: concise Markdown explaining what changed and why

Rules:
- Describe only changes supported by the supplied diff.
- Do not invent tests, issue links, measurements, or implementation details.
- Prefer one short summary paragraph and bullets only when they improve scanning.
- Do not add an empty testing section or repeat the title.
- Use the existing task title only as intent context; the diff is authoritative.

Existing task title:
{{fallbackTitle}}

Committed changes compared with `{{baseBranch}}`:
{{shortstat}}

Files (name-status):
{{files}}

Patch excerpt:
{{patch}}
