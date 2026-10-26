"""PreToolUse hook (Bash|PowerShell): block commits and pushes that contain secrets.

On `git commit` it scans the staged diff; on `git push` it scans the commits that
aren't on the remote yet. Only added lines are checked, so removing a secret is
never blocked. A match denies the command with the file, line and kind of secret
(the value itself is never echoed back).
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.environ.get("CLAUDE_PROJECT_DIR", ".")

# (name, pattern). Kept specific to avoid noise on ordinary code.
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


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout


def outgoing_diff():
    """Diff of commits that would be pushed: everything not on any remote branch."""
    revs = git("rev-list", "HEAD", "--not", "--remotes").split()
    if not revs:
        return "", []
    files = git("diff", "--name-only", f"{revs[-1]}^", "HEAD").split() if len(revs) else []
    return git("diff", f"{revs[-1]}^", "HEAD", "--unified=0"), files


def scan(diff, files):
    findings, current = [], None
    for f in files:
        if SECRET_FILES.search(f) and not ALLOW_FILES.search(f):
            findings.append(f"{f}: secret-type file")
    line_no = 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else None
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            line_no = int(m.group(1)) - 1 if m else 0
        elif line.startswith("+") and current:
            line_no += 1
            for name, pat in SECRET_PATTERNS:
                if re.search(pat, line):
                    findings.append(f"{current}:{line_no}: {name}")
                    break
    return findings


def main():
    command = (json.load(sys.stdin).get("tool_input") or {}).get("command", "")
    if re.search(r"\bgit\b[^|;&]*\bcommit\b", command):
        diff = git("diff", "--cached", "--unified=0")
        files = git("diff", "--cached", "--name-only").split()
        if " -a" in command or "--all" in command:  # commit -a stages tracked changes too
            diff += git("diff", "--unified=0")
            files += git("diff", "--name-only").split()
    elif re.search(r"\bgit\b[^|;&]*\bpush\b", command):
        diff, files = outgoing_diff()
    else:
        return
    findings = scan(diff, files)
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
