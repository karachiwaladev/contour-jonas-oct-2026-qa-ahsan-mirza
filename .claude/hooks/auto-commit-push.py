"""Stop hook: commit any pending changes and push the current branch.

Non-destructive by design: never forces, never rewrites history, skips while a
merge/rebase is in progress, and respects .gitignore. Push uses gh's stored
credentials so it works in non-interactive sessions.

Two guards keep it from bypassing review:
- It never pushes main/master. Leftover edits there move to a new factory/wip-* branch,
  so they reach main only through a PR.
- It runs the same secret scan as secret-scan.py on what it commits and pushes.
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR", "."))
GH_CANDIDATES = ["gh", r"C:\Program Files\GitHub CLI\gh.exe", "/c/Program Files/GitHub CLI/gh.exe"]
TRAILER = "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
PROTECTED_BRANCHES = {"main", "master"}

def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


secret_scan = _load("secret_scan", "secret-scan.py")
log_prompts = _load("log_prompts", "log-prompts.py")


def git(*args, check=False):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, encoding="utf-8",
                          errors="replace", check=check)


def find_gh():
    for candidate in GH_CANDIDATES:
        try:
            subprocess.run([candidate, "--version"], capture_output=True, check=True)
            return candidate
        except (OSError, subprocess.CalledProcessError):
            continue
    return None


def say(msg):
    print(json.dumps({"systemMessage": msg}))


def main():
    raw = sys.stdin.read()
    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        return
    # Write the prompt log first, so this stop's prompts are part of this stop's commit.
    log_notes = []
    try:
        added = log_prompts.log(json.loads(raw) if raw.strip() else {})
        if added:
            log_notes.append(f"logged {added} prompt(s)")
    except Exception as e:  # logging must never stop the commit/push
        log_notes.append(f"prompt log skipped ({e.__class__.__name__})")
    bad_lines = log_prompts.validate()
    git_dir = Path(git("rev-parse", "--git-dir").stdout.strip())
    if not git_dir.is_absolute():
        git_dir = ROOT / git_dir
    if any((git_dir / p).exists() for p in ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD")):
        return  # never commit in the middle of a merge or rebase

    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch == "HEAD":
        return  # detached HEAD: nothing safe to push to

    notes = list(log_notes)
    dirty = bool(git("status", "--porcelain").stdout.strip())
    if branch in PROTECTED_BRANCHES:
        if not dirty:
            return  # never push the default branch directly; work reaches it only via reviewed PRs
        # Leftover edits on main go to their own branch, so they arrive as a PR, not a direct push.
        branch = time.strftime("factory/wip-%Y%m%d-%H%M%S")
        git("checkout", "-q", "-b", branch)  # carries the uncommitted changes along
        notes.append(f"moved leftover changes off main to {branch}")

    if dirty:
        git("add", "-A")
        if bad_lines:  # never commit a log that isn't one valid JSON object per line
            git("reset", "-q", "--", str(log_prompts.LOG))
            notes.append(f"prompt log NOT committed: invalid JSON on line(s) {bad_lines[:5]}")
        secrets = secret_scan.scan_staged()
        if secrets:
            git("reset", "-q")  # unstage only; the working tree is untouched
            say("auto-commit-push: NOT committed. Possible secrets: " + "; ".join(secrets[:5])
                + ". Remove them, then commit.")
            return
        changed = git("diff", "--cached", "--name-only").stdout.split()
        if changed:
            summary = ", ".join(changed[:5]) + (f" (+{len(changed) - 5} more)" if len(changed) > 5 else "")
            msg = f"factory: auto-commit on stop\n\nFiles: {summary}\n\n{TRAILER}"
            if git("commit", "-q", "-m", msg).returncode == 0:
                notes.append(f"committed {len(changed)} file(s)")

    upstream_ok = git("rev-parse", "--verify", f"origin/{branch}").returncode == 0
    ahead = git("rev-list", "--count", f"origin/{branch}..HEAD").stdout.strip() if upstream_ok else "1"
    if ahead and ahead != "0":
        secrets = secret_scan.scan_outgoing("HEAD")
        if secrets:
            say("auto-commit-push: NOT pushed. Possible secrets in unpushed commits: " + "; ".join(secrets[:5]))
            return
        gh = find_gh()
        helper = f'!"{gh}" auth git-credential' if gh else None
        cmd = ["-c", "credential.helper="] + (["-c", f"credential.helper={helper}"] if helper else [])
        push = git(*cmd, "push", "-u", "origin", branch)  # plain push: never --force
        if push.returncode == 0:
            notes.append(f"pushed {branch} to origin")
        else:
            err = (push.stderr.strip().splitlines() or ["unknown error"])[-1]
            notes.append(f"push failed ({ahead} commit(s) waiting): {err}")

    if notes:
        say("auto-commit-push: " + "; ".join(notes))


if __name__ == "__main__":
    main()
