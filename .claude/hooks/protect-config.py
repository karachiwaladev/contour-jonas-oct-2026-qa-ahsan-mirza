"""PreToolUse hook (Edit|Write|NotebookEdit|Bash|PowerShell): guard the factory's own controls.

Hooks, settings, MCP config and CI define what the agent is allowed to do. A ticket
(or instructions hidden in one) must never be able to loosen them, so any change to
these paths asks the human for confirmation instead of going through silently.
"""
import json
import re
import sys

PROTECTED = re.compile(
    r"(^|[\\/\s'\"=>])(\.claude[\\/](settings(\.local)?\.json|hooks[\\/])|\.mcp\.json|\.github[\\/]workflows[\\/]|\.git[\\/]hooks[\\/])",
    re.IGNORECASE,
)
# Shell commands that write to a protected path (redirects, copies, moves, editors via sed -i, etc.).
SHELL_WRITE = re.compile(r"(>|>>|\btee\b|\bcp\b|\bmv\b|\bsed\s+-i|\bSet-Content\b|\bOut-File\b|\bCopy-Item\b|\bMove-Item\b|\bAdd-Content\b)")


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
