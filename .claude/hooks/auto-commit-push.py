"""Stop hook: commit any pending changes and push the current branch.

Non-destructive by design: never forces, never rewrites history, skips while a
merge/rebase is in progress, and respects .gitignore. Push uses gh's stored
credentials so it works in non-interactive sessions.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR", "."))
GH_CANDIDATES = ["gh", r"C:\Program Files\GitHub CLI\gh.exe", "/c/Program Files/GitHub CLI/gh.exe"]
TRAILER = "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"


def git(*args, check=False):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=check)


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
    sys.stdin.read()  # payload unused; read so the pipe drains
    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        return
    git_dir = Path(git("rev-parse", "--git-dir").stdout.strip())
    if not git_dir.is_absolute():
        git_dir = ROOT / git_dir
    if any((git_dir / p).exists() for p in ("MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD")):
        return  # never commit in the middle of a merge or rebase

    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch == "HEAD":
        return  # detached HEAD: nothing safe to push to

    notes = []
    if git("status", "--porcelain").stdout.strip():
        git("add", "-A")
        changed = git("diff", "--cached", "--name-only").stdout.split()
        if changed:
            summary = ", ".join(changed[:5]) + (f" (+{len(changed) - 5} more)" if len(changed) > 5 else "")
            msg = f"factory: auto-commit on stop\n\nFiles: {summary}\n\n{TRAILER}"
            if git("commit", "-q", "-m", msg).returncode == 0:
                notes.append(f"committed {len(changed)} file(s)")

    upstream_ok = git("rev-parse", "--verify", f"origin/{branch}").returncode == 0
    ahead = git("rev-list", "--count", f"origin/{branch}..HEAD").stdout.strip() if upstream_ok else "1"
    if ahead and ahead != "0":
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
