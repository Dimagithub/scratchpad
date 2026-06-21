# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. This repo is **multi-context**.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — system-wide architectural decisions. Read the ADRs that touch the area you're about to work in.
- **`src/<context>/docs/adr/`** — context-scoped decisions, if present.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Contexts

This repo splits into two contexts:

- **frontend** — the React 19 / TypeScript UI in `src/` → `src/CONTEXT.md`
- **backend** — the Rust / Tauri 2 host in `src-tauri/` → `src-tauri/CONTEXT.md`

## File structure

```
/
├── CONTEXT-MAP.md                     ← points at each context's CONTEXT.md
├── docs/adr/                          ← system-wide decisions
├── src/                               ← frontend context
│   ├── CONTEXT.md
│   └── docs/adr/                      ← context-specific decisions
└── src-tauri/                         ← backend context
    ├── CONTEXT.md
    └── docs/adr/                      ← context-specific decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant context's `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
