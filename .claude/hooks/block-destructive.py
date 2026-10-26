"""PreToolUse hook (Bash|PowerShell): deny destructive commands in this repo.

The factory loop may create and edit, but never delete, rewrite history, or
destroy remote state. Matching commands are denied with a reason Claude sees.
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
]


def main():
    payload = json.load(sys.stdin)
    command = (payload.get("tool_input") or {}).get("command", "")
    for pattern, reason in RULES:
        if re.search(pattern, command, re.IGNORECASE):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Blocked by factory safety hook: {reason}. "
                        "The factory only creates and edits; it never deletes or rewrites history. "
                        "Ask the user to do this themselves if it's really needed."
                    ),
                }
            }))
            return


if __name__ == "__main__":
    main()
