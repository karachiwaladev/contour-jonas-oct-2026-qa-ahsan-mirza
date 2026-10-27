"""PreToolUse hook (Bash|PowerShell|Read|Grep|Glob): deny destructive and dangerous actions.

The factory loop may create and edit, but never delete (rm -rf …), rewrite history
(git push --force …), run downloaded code (curl … | sh) or read secrets files (.env).
Matching calls are denied with a reason Claude sees. permissions.deny in
.claude/settings.json lists the same things as a second, independent layer.
"""
import json
import re
import sys

# (pattern, reason). Patterns are matched case-insensitively against the command.
RULES = [
    (r"\brm\s+(-\w*\s+)*-\w*[rf]", "recursive/forced delete (rm -r / rm -f)"),
    (r"\brm\s+", "deleting files (rm)"),
    (r"\brmdir\b|\brd\s+/s\b|\bdel\s+", "deleting files or directories"),
    (r"\bRemove-Item\b|\bri\s+-|\bClear-Content\b", "deleting files (Remove-Item / Clear-Content)"),
    (r"\bgit\s+push\b.*(--force|-f\b|--force-with-lease|\s\+\S)", "force push"),
    (r"\bgit\s+push\b.*(--delete|\s:\S)", "deleting a remote branch"),
    (r"\bgit\s+reset\s+.*--hard", "git reset --hard"),
    (r"\bgit\s+clean\b", "git clean (deletes untracked files)"),
    (r"\bgit\s+(checkout|restore)\s+(.*\s)?(--\s+)?\.(\s|$)", "discarding working-tree changes"),
    (r"\bgit\s+branch\s+.*-[dD]\b", "deleting a branch"),
    (r"\bgit\s+(rebase|filter-branch|filter-repo)\b|\bgit\s+commit\b.*--amend", "rewriting git history"),
    (r"\bgit\s+stash\s+(drop|clear)\b", "dropping stashed work"),
    (r"\bgh\s+(repo|release|issue|label|gist|secret|variable)\s+delete\b", "deleting GitHub resources"),
    (r"\bgh\s+api\b.*-X\s*DELETE|\bgh\s+api\b.*--method\s+DELETE", "DELETE request to the GitHub API"),
    (r"\bgh\s+repo\s+(archive|rename|edit)\b", "changing repository settings"),
    (r"\bmkfs\b|\bformat\s+[a-z]:|\bdd\s+if=", "disk-level destructive command"),
    (r">\s*/dev/sd|\bshred\b", "overwriting devices or shredding files"),
    # Downloading and executing remote code in one step (curl … | sh, iwr … | iex, bash <(curl …)).
    (r"\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^;&]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish|pwsh|powershell|python3?|node|perl|ruby|iex|Invoke-Expression)\b",
     "piping a download into a shell or interpreter (curl | sh)"),
    (r"\b(sh|bash|zsh|source|\.)\s+<\(\s*(curl|wget)\b", "executing a downloaded script (bash <(curl …))"),
    (r"\b(iex|Invoke-Expression)\b[^;&]*\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b",
     "executing a downloaded script (iex (iwr …))"),
    # Reading secrets files through the shell (.env, .env.local, … but not .env.example).
    (r"\b(cat|type|more|less|head|tail|bat|nl|strings|xxd|od|grep|egrep|rg|findstr|awk|sed|source|Get-Content|gc|Select-String|sls|Import-Csv|cp|copy|Copy-Item|scp|base64|open|start|notepad|code)\b[^|;&]*"
     r"(^|[\s/\\'\"=])\.env(?!\.example\b)(\.[\w.-]+)?(?=$|[\s'\"|;&)])",
     "reading a .env secrets file"),
    (r"(^|[;&|]\s*)\.\s+[^|;&]*\.env(?!\.example\b)\b", "sourcing a .env secrets file"),
    (r"\bopen\(\s*['\"][^'\"]*\.env(?!\.example)(\.[\w.-]+)?['\"]", "reading a .env secrets file from a script"),
]

# Secrets files must not be read by the Read/Grep/Glob tools either (.env.example is fine).
ENV_FILE = re.compile(r"(^|[\\/])\.env(?!\.example$)(\.[\w.-]+)?$", re.IGNORECASE)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Blocked by factory safety hook: {reason}. "
                "The factory never deletes, rewrites history, runs downloaded scripts or reads secrets files. "
                "Ask the user to do this themselves if it's really needed."
            ),
        }
    }))


def main():
    payload = json.load(sys.stdin)
    tool, inp = payload.get("tool_name", ""), payload.get("tool_input") or {}
    if tool in ("Read", "Grep", "Glob", "NotebookRead"):
        target = inp.get("file_path") or inp.get("path") or inp.get("notebook_path") or ""
        pattern = inp.get("pattern", "") if tool == "Glob" else ""
        if ENV_FILE.search(target.rstrip("\\/")) or re.search(r"(^|[\\/*])\.env(?!\.example)(\.[\w.*-]+)?$", pattern):
            deny("reading a .env secrets file")
        return
    command = inp.get("command", "")
    for pattern, reason in RULES:
        if re.search(pattern, command, re.IGNORECASE):
            deny(reason)
            return


if __name__ == "__main__":
    main()
