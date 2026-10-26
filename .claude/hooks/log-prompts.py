"""Stop hook: append this session's new user prompts to .claude/logs/prompts.jsonl.

Reads the hook payload (session_id, transcript_path) from stdin, scans the
transcript for real user prompts, and appends any whose uuid isn't logged yet.
"""
import json
import os
import re
import sys
from pathlib import Path

LOG = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".claude" / "logs" / "prompts.jsonl"
COMMAND_RE = re.compile(r"<command-name>(.*?)</command-name>.*?(?:<command-args>(.*?)</command-args>)?", re.S)


def prompt_text(entry):
    """Return the typed prompt text, or None if the entry isn't a user prompt."""
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain"):
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


def main():
    payload = json.load(sys.stdin)
    transcript = payload.get("transcript_path")
    if not transcript or not os.path.exists(transcript):
        return

    seen = set()
    if LOG.exists():
        with LOG.open(encoding="utf-8") as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["uuid"])
                except (ValueError, KeyError):
                    pass

    new = []
    with open(transcript, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            text = prompt_text(entry)
            if text is None or entry.get("uuid") in seen:
                continue
            record = {
                "timestamp": entry.get("timestamp"),
                "session_id": entry.get("sessionId", payload.get("session_id")),
                "uuid": entry.get("uuid"),
                "kind": "prompt",
                "prompt": text,
            }
            m = COMMAND_RE.search(text)
            if m:
                record.update(kind="command", command=m.group(1).strip(), args=(m.group(2) or "").strip())
            new.append(record)

    if new:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            for r in new:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
