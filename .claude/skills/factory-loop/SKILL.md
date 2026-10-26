---
name: factory-loop
description: Work through the open GitHub issues ("tickets") in the current repo like a software factory. Answer the question tickets as comments and close them. Complete the task tickets ("create a file…", "add…", "update the README…") by making the change on a branch and opening a pull request that closes the issue. Use this whenever the user asks to fetch, triage, answer, work on, complete, or close issues or tickets, says "process the tickets", "run the factory", "work the issue queue", or wants that done on a recurring /loop, even if they don't say "factory-loop". Also covers dry runs ("don't post anything", "just show me what you'd do").
---

# Factory loop

Treat the repo's open issues as a work queue. Every ticket is one of three kinds:

- **Question**: answer it in a comment and close the issue.
- **Task**: do the work in the repo, open a pull request that closes the issue, and link the PR on the issue.
- **Needs a human**: skip it and flag it in the report.

The skill should be safe to run over and over, for example from `/loop 5m /factory-loop`. A run that finds nothing new should change nothing and say so in one line.

## 0. Mode

- **Live** (the default): react, comment, close, commit, push and open PRs.
- **Dry run**: use this when the user says "dry run", "don't post", "preview", "just show me", or anything similar. Still do all the reading, including the permission check, but make **no** write calls: no reactions, no comments, no closes, no pushes, no PRs. For each issue, show the exact comment or the planned change you *would* make.

## 1. Find `gh` and the repo

`gh` is often not on PATH in Git Bash on Windows. Try `gh`, then `"/c/Program Files/GitHub CLI/gh.exe"` (Bash) or `& "C:\Program Files\GitHub CLI\gh.exe"` (PowerShell). Run `gh auth status` to learn the login. Call it `ME`; you need it later.

Repo: use the one the user names. Otherwise take `owner/name` from `git remote get-url origin`. Don't rely on `gh search issues --owner @me`: it fails when the account owns no repos, and workshop or org repos usually belong to someone else anyway.

## 2. Check permissions before acting

```
gh api repos/OWNER/REPO --jq '.permissions'
```

- **Closing** someone else's issue needs `triage` or higher. Authors can always close their own issues, so decide closeability per issue. With only `pull`, reacting and commenting still work.
- **Pushing** a branch needs `push`. Without it, work from a fork (see 4b).

Knowing this up front lets you skip a call that would fail and explain it once in the report, instead of hitting the same error on every issue and every loop tick. If access is missing, also check `gh api user/repository_invitations` for a pending invite and mention it. Don't accept an invite yourself; that's the user's call.

## 3. Fetch and sort the queue

```
gh issue list -R OWNER/REPO --state open --limit 50 --json number,title,body,author,comments,labels,url
gh pr list -R OWNER/REPO --state open --author ME --json number,title,body,url,headRefName
```

Skip pull requests in the issue list. For each issue, decide:

- **Already handled**: a comment from `ME` contains `<!-- factory-loop -->`, or `ME` already answered it, or one of `ME`'s open PRs says `Closes #N`. Don't redo it; duplicates are the main way a loop makes noise. For a question, only try the close if permissions allow.
- Otherwise, classify it. Workshop tickets are often phrased as instructions, such as "Create the ticket asking a question about X?", where the real content is the question X.
  - **Question**: it asks for information. Go to 4a.
  - **Task**: it asks for a concrete change to this repo, and you can tell what "done" looks like, for example "create a CLAUDE.md that…" or "add a folder for…". Go to 4b.
  - **Needs a human**: the ticket is ambiguous, needs secrets or access you don't have, needs changes outside this repo, or is risky (deleting things, touching CI, deployment, security). Skip it.

React with 👀 (`gh api -X POST repos/OWNER/REPO/issues/N/reactions -f content=eyes`) on every question and task you pick up, unless `ME` already reacted.

## 4a. Answer a question

1. Post a comment. Give the direct answer in the first line, in bold, then one to three sentences of supporting context. Hedge figures that come from memory ("roughly", "about", with the source year). For questions with no single answer, say so and give a short, balanced overview. Write the body to a temp file and use `--body-file` so quotes and newlines survive the shell. End the body with `<!-- factory-loop -->` on its own line. The marker is invisible on GitHub; it's how the next run knows the issue is done.
2. Close it if you can: `gh issue close N -R OWNER/REPO --reason completed`, then confirm with `gh issue view N --json state`.

## 4b. Complete a task

0. **Follow the repo's own workflow.** Read `README.md` and `CLAUDE.md` first. If they say how work ships, for example "Push to `main`", do that instead of the branch-and-PR flow below: commit on `main` and `git push origin main`. Workshop repos are often scored on what lands on `main`.
1. **Start clean.** Run `git status`. If the working tree has someone else's uncommitted changes, don't mix them in: skip the task and report it. Fetch and branch from the default branch: `git fetch origin && git checkout -b factory/issue-N origin/main`.
2. **Do the work.** Read the relevant existing files first so the change fits the repo. Meet every requirement in the ticket and check each one explicitly at the end, for example "under 100 lines" means you count the lines. Keep the change scoped to the ticket.
3. **Commit** with a message like `Resolve #N: <short summary>` and the session's attribution trailer if there is one.
4. **Push.**
   - If you have `push`: `git push -u origin factory/issue-N`.
   - Otherwise keep the commit local and report that it's waiting on push access. Only fork (`gh repo fork OWNER/REPO --remote --remote-name fork`, then push there) if the user has said forking is OK. A fork creates a new repo on their account, and the work won't count until the owner merges it.
   - `git push` over HTTPS may not have credentials even when `gh` does. Use `git -c credential.helper= -c 'credential.helper=!"<gh path>" auth git-credential' push …` rather than changing global git config.
   - Don't comment "done" on the issue until the work is actually on GitHub.
5. **Open the PR** against the upstream default branch:
   `gh pr create -R OWNER/REPO --base main --head <ME>:factory/issue-N --title "<ticket title>" --body-file <tmp>`
   The body should summarise what changed, show how each requirement was met, and include `Closes #N` so merging closes the issue.
6. **Comment on the issue** with a one-line summary and the PR link, ending with the marker. Don't close the issue yourself; merging the PR closes it.
7. **Go back** to the branch you started on (`git checkout main`) so the next tick starts from a clean state.

If a step fails partway, for example a push is rejected or the fork can't be created, stop work on that ticket, leave the branch local, and report exactly where it stopped. Don't retry blindly on every tick.

## 5. Report

End with a short summary the user can scan:

```
factory-loop · OWNER/REPO · ME · live|dry run
#1 Largest city in Pakistan: answered (Karachi), 👀, closed ✅
#4 CLAUDE.md for the factory: done → PR #5 (Closes #4), 👀, commented
#6 Rotate prod API keys: skipped, needs a human (needs secrets)
#3 Capital of Japan: answered, ⚠️ not closed: Amirza-alt has read-only access
```

Include links to the comments and PRs you created. If nothing needed doing: `factory-loop: no new tickets in OWNER/REPO.` If access blocked a close or push, say once what access is needed and who can grant it (the repo owner).

## Running on a loop

If the user wants this to repeat, suggest `/loop 5m /factory-loop`, or schedule it with CronCreate if you're already inside `/loop`. The "already handled" checks in step 3 make each tick cheap and idempotent.
