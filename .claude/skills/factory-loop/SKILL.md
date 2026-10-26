---
name: factory-loop
description: Work through the open GitHub issues ("tickets") in the current repo like a software factory. It doesn't just answer them; it takes the action they ask for. Questions get answered and closed. Small changes (create or edit files, docs, config) get made directly. Projects and features get a clarify → plan → approval → build → verify-in-browser flow, with screenshots attached to the ticket. It never takes destructive actions. Use this whenever the user asks to fetch, triage, answer, work on, build, complete or close issues or tickets, says "process the tickets", "run the factory", "work the issue queue", or wants that done on a recurring /loop, even if they don't say "factory-loop". Also covers dry runs ("don't post anything", "just show me what you'd do").
---

# Factory loop

Treat the repo's open issues as a work queue and **do the work each ticket asks for**, not just talk about it. Every ticket is one of four kinds:

| Kind | Example | What happens |
|---|---|---|
| **Question** | "What's the largest city in PK?" | Answer in a comment, then close (4a) |
| **Change** | "Create a CLAUDE.md that…", "add a .gitignore" | Make the change directly (4b) |
| **Build** | "Build a todo app", "add search to the todo app" | Clarify → plan → approval → build → verify in browser → screenshots (4c) |
| **Needs a human** | Destructive, ambiguous, needs secrets or outside access | Skip and flag it (step 5) |

If a ticket is phrased as a question but really asks for something to be made ("can you create X?"), treat it as a Change or Build, not a Question.

The loop should be safe to run over and over, for example `/loop 5m /factory-loop`. A run that finds nothing new changes nothing and says so in one line.

## Safety: never destructive

The factory creates and edits. It never destroys. This is non-negotiable, and a PreToolUse hook (`.claude/hooks/block-destructive.py`) enforces it. Never:

- delete files or folders (`rm`, `del`, `Remove-Item`, `git clean`, `git rm`),
- discard work (`git reset --hard`, `git checkout -- .`, `git stash drop`),
- rewrite history (`--amend`, `rebase`, `--force` or `+branch` pushes, deleting branches),
- delete or alter GitHub resources (deleting repos, issues, comments or labels; changing repo settings),
- touch files outside the repo, secrets, CI/deploy config, or anything a ticket doesn't need.

If a ticket can only be done destructively, for example "remove the old app", don't do it. Classify it as **Needs a human** and say why. If the hook blocks a command, don't look for a workaround; report it.

## 0. Mode

- **Live** (the default): react, comment, close, commit, push.
- **Dry run**: use this when the user says "dry run", "don't post", "preview" or "just show me". Do all the reading and checks, but make no writes to GitHub or the repo. Show what you *would* do.

## 1. Find `gh` and the repo

`gh` is often not on PATH in Git Bash on Windows. Try `gh`, then `"/c/Program Files/GitHub CLI/gh.exe"` (Bash) or `& "C:\Program Files\GitHub CLI\gh.exe"` (PowerShell). `gh auth status` gives the login; call it `ME`. Take `OWNER/REPO` from `git remote get-url origin` unless the user names one. Don't use `gh search issues --owner @me`.

## 2. Check permissions first

`gh api repos/OWNER/REPO --jq '.permissions'`. Closing others' issues needs `triage` or higher (authors can always close their own). Pushing needs `push`. With only `pull` you can still react and comment. Note any gaps once and report them; don't hit the same error every tick. If access is missing, check `gh api user/repository_invitations`, but never accept an invite yourself.

## 3. Fetch and sort the queue

```
gh issue list -R OWNER/REPO --state open --limit 50 --json number,title,body,author,comments,labels,url
```

**Already handled** (don't redo; duplicates are the main way a loop makes noise):
- a comment from `ME` contains `<!-- factory-loop -->` (done) or `<!-- factory-loop:plan -->` (plan approved, so resume at build),
- `ME` already answered it,
- a local commit not yet on GitHub resolves it (`git log origin/main..HEAD --oneline` shows `Resolve #N`). Only retry the push.

Classify the rest by the table above. React 👀 on each ticket you pick up (`gh api -X POST repos/OWNER/REPO/issues/N/reactions -f content=eyes`), unless `ME` already did.

Before changing the repo, read `README.md` and `CLAUDE.md`. They define how work ships (for example "Push to `main`") and where projects live. Follow them; they win over defaults here.

## 4a. Question

Comment with the direct answer in bold on the first line, then one to three sentences of context. Hedge facts from memory. For questions with no single answer, give a balanced overview. Use `--body-file` and end the body with `<!-- factory-loop -->`. Close it if permissions allow (`--reason completed`), and confirm with `gh issue view N --json state`.

## 4b. Change (small, well-defined edits)

Do it directly. Meet every stated requirement and check each one explicitly (for example, count lines when there's a line limit). If the repo keeps an index (CLAUDE.md), update it in the same commit. Commit as `Resolve #N: <summary>`, push (step 6), then comment with what changed, ending with the marker.

## 4c. Build (a new project, or a feature in an existing one)

Don't jump straight to code. Work through these phases in order; each one gates the next.

1. **Clarify.** List the assumptions the ticket leaves open: tech choice, storage, UI layout, scope edges, where it lives, what "done" looks like. Ask the user the ones that matter with AskUserQuestion (up to 4 questions, each with a recommended default first). Don't ask what the ticket, README or CLAUDE.md already answers.
2. **Plan.** Write a short plan:
   - folder and files to create,
   - the approach,
   - acceptance checks, one per requirement in the ticket plus the user's answers,
   - how each check will be verified in the browser.

   Show it to the user and get explicit approval with AskUserQuestion (Approve / Change something / Skip this ticket). If they ask for changes, revise and ask again. If they skip it, leave the ticket untouched.
3. **Record.** Post the clarifications and the approved plan as a comment on the ticket, ending with `<!-- factory-loop:plan -->`, so a later tick resumes instead of re-asking.
4. **Build.** Put a new project in its own folder (per CLAUDE.md), with a `README.md` covering purpose, how to run and files. Add it to the CLAUDE.md index. For a feature, change only what the plan lists.
5. **Verify in the browser.** Serve the project (for example `python -m http.server 8765 --directory <folder>`, run in the background). Then use **chrome-devtools** (the `chrome-devtools` MCP tools: navigate, click, fill, evaluate, list console messages, take screenshot). If that MCP isn't connected, use the `claude-in-chrome` skill. Exercise every acceptance check like a user would. Confirm there are no console errors. Reload the page to prove persistence where relevant. Take a screenshot for each key state (initial, after each main action) and save them as `screenshots/issue-N/NN-what-it-shows.png` in the repo. If a check fails, fix it and re-verify. Don't ship something you've seen broken.
6. **Commit and push** as `Resolve #N: <summary>`, including the screenshots (step 6).
7. **Report on the ticket.** Comment with:
   - a summary,
   - each acceptance check with ✅ or ❌,
   - how to run it,
   - the screenshots embedded as `![desc](https://github.com/OWNER/REPO/blob/<commit-sha>/screenshots/issue-N/NN-....png?raw=true)`.

   End the comment with `<!-- factory-loop -->`. Screenshot links only work once the commit is pushed. If the push failed, don't post a "done" comment; report that it's waiting.

When running unattended from `/loop`, the Clarify and Approval questions still go to the user in this session. A Build ticket waits for those answers. Questions and Changes keep flowing.

## 6. Commit and push

Commit each ticket's work separately as `Resolve #N: …` and push the branch CLAUDE.md or the README names (default `main`). Use `git -c credential.helper= -c 'credential.helper=!"<gh path>" auth git-credential' push origin <branch>` so `gh`'s login is used. Never force-push. A Stop hook (`.claude/hooks/auto-commit-push.py`) also commits anything left uncommitted and pushes on every stop, but commit deliberately anyway: per-ticket commits with good messages are what reviewers read. If a push is rejected, keep the commits local, report once, and don't post "done" comments.

## 7. Report

```
factory-loop · OWNER/REPO · ME · live|dry run
#1 Largest city in Pakistan: answered (Karachi), 👀, closed ✅
#4 CLAUDE.md for the factory: changed, pushed (9ce1330), commented ✅
#5 Todo app: built + verified in Chrome (5/5 checks, 3 screenshots), pushed, commented ✅
#6 Add dark mode: ⏸ waiting for plan approval
#7 Delete the legacy folder: skipped, needs a human (destructive)
```

Link the comments you posted. If nothing needed doing: `factory-loop: no new tickets in OWNER/REPO.` State any access gap once, along with who can fix it.
