# CLAUDE.md: Software Factory

This repo is a **software factory**. Work arrives as GitHub issues ("tickets"). An agent loop
picks each one up, does the work, and reports back on the ticket. Humans build and improve the
loop; the loop builds the features.

**Rule: keep this file under 100 lines.** It is the entry point and index, not the encyclopedia.

## How the factory works

1. **Intake:** tickets are opened as issues (`Ticket #1`, `Ticket #2`, …).
2. **Loop:** the `factory-loop` skill (`.claude/skills/factory-loop/`) polls open issues and
   sorts each one into a question, a task, or a ticket that needs a human.
3. **Do:** questions get an answer comment. Tasks get a change committed to the repo.
4. **Report:** every handled ticket gets an 👀 reaction and a comment; the loop is idempotent.
5. **Ship:** only what is on GitHub counts (files, issues, comments, commits). Push to `main`.

## Progressive disclosure

Context is loaded in layers, so an agent reads only what the current ticket needs:

- **Layer 1 (always loaded):** this file. It holds the purpose, the rules, and the index below.
  It stays short so it costs little on every turn.
- **Layer 2 (loaded per project):** each project folder has its own `README.md` (or
  `CLAUDE.md`) describing that project: its goal, layout, commands and conventions.
- **Layer 3 (loaded on demand):** source files, docs, specs and references inside the project
  folder, read only when a task touches them.

Don't put project details here. Add them to the project's own folder and link to it from the index.

## Project layout

- Every project lives in **its own top-level folder**, in kebab-case (for example `city-facts/`).
- Each project folder starts with a `README.md`: one paragraph on its purpose, then how to run
  and test it.
- Shared agent tooling lives in `.claude/` (skills, settings), not in project folders.
- A new project isn't done until it has a row in the index below.

## Index

The single source of truth for what exists in this repo. Update it in the same commit that adds,
renames or removes a project.

| Project | Folder | Ticket | Status | Summary |
|---|---|---|---|---|
| Factory base | `/` (this file) | #4 | active | Factory rules, progressive disclosure, index |

### Tooling

| Tool | Location | Purpose |
|---|---|---|
| factory-loop | `.claude/skills/factory-loop/SKILL.md` | Works the issue queue: answers, tasks, reports |

## Working rules for agents

- Read this file first, then only the project folder the ticket points at.
- Keep each change scoped to its ticket. Reference the ticket in the commit (`Resolve #N: …`).
- Check every requirement in a ticket before calling it done (counts, limits, file names).
- Training repo only: no Jonas or Contour code, and no real keys or secrets.
- If a ticket is ambiguous or risky, leave it open and flag it for a human instead of guessing.
