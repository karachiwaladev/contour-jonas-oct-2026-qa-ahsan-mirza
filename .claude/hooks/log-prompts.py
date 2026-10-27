"""Keep .claude/logs/prompts.jsonl: every prompt of the session, one JSON object per line.

Called by the auto-commit-push.py Stop hook before it commits, so the log is written first and
committed in the same step. It can also run on its own as a hook (reads the payload on stdin).

Each line has: timestamp (when the prompt was sent, ISO 8601 UTC), session_id, uuid,
kind ("prompt" | "command" | "scheduled"), prompt, and for commands the command name and args.
"scheduled" covers prompts fired by /loop and cron jobs, which Claude Code marks as
system-generated but which are still prompts the user set up.

The file is append-only: each stop appends only prompts whose uuid isn't in the file yet,
so every prompt is written exactly once and earlier lines are never rewritten.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

LOG = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".claude" / "logs" / "prompts.jsonl"
COMMAND_RE = re.compile(r"<command-name>(.*?)</command-name>.*?(?:<command-args>(.*?)</command-args>)?", re.S)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def prompt_kind(entry):
    """'prompt', 'scheduled' or None. None means not something the user typed or scheduled."""
    if entry.get("type") != "user" or entry.get("isSidechain"):
        return None
    if entry.get("isMeta"):
        # System-injected turns: skill bodies, agent hand-backs, reminders. The one kind worth
        # logging is a prompt the user scheduled (/loop, cron), which carries a scheduledTaskId.
        return "scheduled" if entry.get("scheduledTaskId") and not entry.get("turnCompanion") else None
    return "prompt"


def prompt_text(entry):
    """Return the prompt text, or None if the entry isn't a user prompt."""
    if not prompt_kind(entry):
        return None
    content = entry.get("message", {}).get("content")
    if isinstance(content, list):
        if any(b.get("type") != "text" for b in content):
            return None  # tool results, images with tool output, etc.
        content = "\n".join(b.get("text", "") for b in content)
    if not isinstance(content, str) or not content.strip():
        return None
    if content.lstrip().startswith("<task-notification>"):
        return None  # background-task events, not typed by the user
    return content


def validate():
    """Line numbers in the log that aren't a single valid JSON object (empty list = all good)."""
    bad = []
    if LOG.exists():
        with LOG.open(encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                try:
                    if not isinstance(json.loads(line), dict):
                        bad.append(i)
                except ValueError:
                    bad.append(i)
    return bad


def _logged_uuids():
    seen = set()
    if LOG.exists():
        with LOG.open(encoding="utf-8") as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["uuid"])
                except (ValueError, KeyError, TypeError):
                    pass  # validate() reports broken lines
    return seen


def log(payload):
    """Append prompts from the session transcript that aren't in LOG yet. Returns how many were added.

    Append-only: existing lines are never rewritten, and each prompt (by uuid) is written once.
    Because it compares against the whole transcript, any prompt missed earlier is picked up
    on the next stop.
    """
    transcript = payload.get("transcript_path")
    if not transcript or not os.path.exists(transcript):
        return 0

    seen = _logged_uuids()
    new = []
    with open(transcript, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            text = prompt_text(entry)
            uid = entry.get("uuid")
            if text is None or not uid or uid in seen:
                continue
            seen.add(uid)
            row = {
                "timestamp": entry.get("timestamp") or now_iso(),  # when the prompt was sent
                "session_id": entry.get("sessionId", payload.get("session_id")),
                "uuid": uid,
                "kind": prompt_kind(entry),
                "prompt": text,
            }
            m = COMMAND_RE.search(text)
            if m:
                row.update(kind="command", command=m.group(1).strip(), args=(m.group(2) or "").strip())
            new.append(row)

    if new:
        new.sort(key=lambda r: r["timestamp"])
        LOG.parent.mkdir(parents=True, exist_ok=True)
        # One JSON object per line, written in a single call so a crash can't leave half a line.
        with LOG.open("a", encoding="utf-8", newline="\n") as f:
            f.write("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in new))
    return len(new)


def main():
    log(json.load(sys.stdin))


if __name__ == "__main__":
    main()
