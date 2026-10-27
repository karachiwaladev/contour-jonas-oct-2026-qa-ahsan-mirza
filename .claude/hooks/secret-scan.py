"""Secret scanning for the factory, used two ways:

1. PreToolUse hook (Bash|PowerShell): before a `git commit` or `git push` the agent runs,
   scan what it would record or publish and deny the command if it contains secrets.
2. Library: auto-commit-push.py imports scan_staged()/scan_outgoing() so the Stop hook's
   own commit and push are scanned too.

Only added lines are checked and deleted files are ignored, so removing a secret is never
blocked. Findings name the file, line and kind of secret, never the value. All git output is
decoded as UTF-8 so a non-ASCII diff can't crash the scan and let a commit through unscanned.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.environ.get("CLAUDE_PROJECT_DIR", ".")

SECRET_PATTERNS = [
    ("AWS access key", r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("GitHub token", r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b"),
    ("Anthropic API key", r"\bsk-ant-[A-Za-z0-9_\-]{20,}"),
    ("OpenAI-style API key", r"\bsk-(proj-)?[A-Za-z0-9]{32,}"),
    ("Slack token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    ("Google API key", r"\bAIza[0-9A-Za-z_\-]{35}\b"),
    ("Stripe live key", r"\b[rs]k_live_[0-9A-Za-z]{20,}"),
    ("Private key block", r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"),
    ("JWT", r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    ("Hard-coded credential",
     r"(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['\"][^'\"\s]{8,}['\"]"),
]
SECRET_FILES = re.compile(r"(^|/)(\.env(\..+)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|credentials\.json)$")
ALLOW_FILES = re.compile(r"(^|/)\.env\.example$")
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, encoding="utf-8", errors="replace")
    return r.stdout


def scan_diff(diff):
    """Scan unified-diff text (git diff / git log -p) for secrets on added lines."""
    findings, current, in_header, line_no = [], None, False, 0
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            in_header, current = True, None
        elif in_header and line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else None  # /dev/null = deleted
        elif line.startswith("@@"):
            in_header = False
            m = re.search(r"\+(\d+)", line)
            line_no = int(m.group(1)) - 1 if m else 0
        elif not in_header and line.startswith("+") and current:
            line_no += 1
            for name, pat in SECRET_PATTERNS:
                if re.search(pat, line):
                    findings.append(f"{current}:{line_no}: {name}")
                    break
    return findings


def scan_names(names):
    return [f"{n}: secret-type file" for n in names if SECRET_FILES.search(n) and not ALLOW_FILES.search(n)]


def scan_staged():
    """What the next commit would record (added/modified/renamed files only)."""
    return (scan_names(git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split())
            + scan_diff(git("diff", "--cached", "--unified=0")))


def scan_worktree(include_untracked):
    """Tracked changes not yet staged, plus untracked files if they're about to be added."""
    findings = (scan_names(git("diff", "--name-only", "--diff-filter=ACMR").split())
                + scan_diff(git("diff", "--unified=0")))
    if include_untracked:
        for name in git("ls-files", "--others", "--exclude-standard").splitlines():
            findings += scan_names([name])
            path = os.path.join(ROOT, name)
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    text = f.read(2_000_000)
            except OSError:
                continue
            findings += scan_diff(f"diff --git a/{name} b/{name}\n+++ b/{name}\n@@ -0,0 +1 @@\n"
                                  + "".join("+" + l + "\n" for l in text.splitlines()))
    return findings


def scan_outgoing(ref="HEAD"):
    """Every commit reachable from `ref` that no remote branch has yet (root commits included)."""
    if not git("rev-list", ref, "--not", "--remotes").strip():
        return []
    log = git("log", "-p", "--unified=0", "--format=", "--first-parent", "-m", "--diff-filter=ACMR",
              ref, "--not", "--remotes")
    names = git("log", "--name-only", "--format=", "--diff-filter=ACMR", ref, "--not", "--remotes").split()
    return scan_names(sorted(set(names))) + scan_diff(log)


def _strip_quotes(cmd):
    return re.sub(r"\"[^\"]*\"|'[^']*'", "''", cmd)


def _push_ref(cmd):
    """Best-effort: the local ref a `git push [remote] [ref]` would publish."""
    args = [a for a in _strip_quotes(cmd).split() if not a.startswith("-")]
    try:
        i = args.index("push")
    except ValueError:
        return "HEAD"
    rest = args[i + 1:]
    if len(rest) >= 2:
        src = rest[1].split(":")[0].lstrip("+")
        if src and git("rev-parse", "--verify", "--quiet", src).strip():
            return src
    return "HEAD"


def main():
    command = (json.load(sys.stdin).get("tool_input") or {}).get("command", "")
    bare = _strip_quotes(command)
    findings = []
    if re.search(r"\bgit\b[^|;&]*\bcommit\b", bare):
        findings += scan_staged()
        commit_all = re.search(r"\bcommit\b[^|;&]*(\s-[A-Za-z]*a[A-Za-z]*\b|\s--all\b)", bare)
        adds_first = re.search(r"\bgit\s+add\b", bare)  # e.g. `git add -A && git commit`
        pathspec = re.search(r"\bcommit\b(?:\s+-\S+)*\s+[^-\s]", bare)  # `git commit file -m x`
        if commit_all or adds_first or pathspec:
            findings += scan_worktree(include_untracked=bool(adds_first))
    if re.search(r"\bgit\b[^|;&]*\bpush\b", bare):
        findings += scan_outgoing(_push_ref(command))
    findings = sorted(set(findings))
    if findings:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "Blocked by factory secret scan. Possible secrets in the changes:\n- "
            + "\n- ".join(findings[:10])
            + "\nRemove them (use an env var or an untracked .env file) and try again. "
              "Never commit real keys to this repo.",
        }}))


if __name__ == "__main__":
    main()
