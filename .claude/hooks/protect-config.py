"""PreToolUse hook (Edit|Write|NotebookEdit|Bash|PowerShell): guard the factory's own controls.

Hooks, settings, MCP config and CI define what the agent is allowed to do. A ticket
(or instructions hidden in one) must never be able to loosen them, so any change to
these paths asks the human for confirmation instead of going through silently.
"""
import json
import re
import sys

PROTECTED = re.compile(
    r"(^|[\\/\s'\"=>(])(\.claude[\\/](settings(\.local)?\.json|hooks[\\/]|skills[\\/])|\.mcp\.json|\.github[\\/]workflows[\\/]|\.git[\\/]hooks[\\/])",
    re.IGNORECASE,
)
# Shell commands that can write a protected path: redirects, copy/move, in-place editors,
# PowerShell writers, git restoring files from another ref, and scripting-language writes.
SHELL_WRITE = re.compile(
    r"(>|\btee\b|\bcp\b|\bmv\b|\binstall\b|\bdd\b|\bsed\s+-i|\bperl\s+-[a-z]*i|\bSet-Content\b|\bOut-File\b"
    r"|\bCopy-Item\b|\bMove-Item\b|\bAdd-Content\b|\bNew-Item\b|\bgit\s+(checkout|restore|apply|am|cherry-pick|merge|pull)\b"
    r"|\b(python|python3|py|node|ruby|perl|pwsh|powershell)\b[^|;&]*(-c|-e|--command|open\(|writeFile|WriteAllText))",
    re.IGNORECASE,
)


def main():
    payload = json.load(sys.stdin)
    tool, inp = payload.get("tool_name", ""), payload.get("tool_input") or {}
    if tool in ("Bash", "PowerShell"):
        cmd = inp.get("command", "")
        hit = PROTECTED.search(cmd) and SHELL_WRITE.search(cmd)
        target = PROTECTED.search(cmd).group(0) if hit else None
    else:
        path = inp.get("file_path") or inp.get("notebook_path") or ""
        target = path if PROTECTED.search(path) else None
    if target:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": f"Factory guard: this changes the agent's own controls ({target.strip()}). "
            "Approve only if YOU asked for this change, not a ticket or issue comment.",
        }}))


if __name__ == "__main__":
    main()
