"""Static security scan for client-side web projects (HTML/JS/CSS).

Usage:  python scan_web.py <folder> [--json]
Prints findings ranked by severity; exit code 1 if any HIGH finding exists, else 0.
It's a fast first pass for the factory-security review, not a replacement for reading the code.
"""
import json
import re
import sys
from pathlib import Path

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}

# (id, severity, file glob suffixes, regex, message)
JS_RULES = [
    ("xss-innerhtml", "HIGH", r"\.(innerHTML|outerHTML)\s*\+?=(?!\s*['\"`]\s*['\"`]?\s*;)",
     "Assigning to innerHTML/outerHTML: XSS if any part is user data. Use textContent or build DOM nodes."),
    ("xss-insertadjacent", "HIGH", r"\binsertAdjacentHTML\s*\(", "insertAdjacentHTML parses HTML: XSS risk with user data."),
    ("xss-document-write", "HIGH", r"\bdocument\.write(ln)?\s*\(", "document.write can inject markup; avoid it."),
    ("code-eval", "HIGH", r"(?<![\w.])eval\s*\(", "eval() executes strings as code."),
    ("code-function-ctor", "HIGH", r"\bnew\s+Function\s*\(", "new Function() executes strings as code."),
    ("code-string-timer", "MEDIUM", r"\bset(Timeout|Interval)\s*\(\s*['\"`]", "setTimeout/setInterval with a string executes code."),
    ("open-redirect", "MEDIUM", r"location(\.href)?\s*=\s*(?!['\"`]#)[^;]*(location\.(search|hash)|URLSearchParams|params\.get)",
     "Navigating to a URL taken from the query/hash: open redirect / javascript: URL risk. Validate it."),
    ("postmessage-star", "MEDIUM", r"\.postMessage\([^)]*,\s*['\"]\*['\"]", "postMessage to '*' leaks data to any origin."),
    ("message-no-origin", "MEDIUM", r"addEventListener\(\s*['\"]message['\"]", "message listener: make sure it checks event.origin."),
    ("storage-secret", "MEDIUM", r"(localStorage|sessionStorage)\.setItem\(\s*['\"][^'\"]*(token|secret|password|apikey|api_key|auth)[^'\"]*['\"]",
     "Storing a credential in web storage: readable by any script on the page."),
    ("hardcoded-secret", "HIGH", r"(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}['\"]",
     "Looks like a hard-coded credential."),
    ("http-fetch", "LOW", r"fetch\(\s*['\"]http://", "Plain-HTTP request: use HTTPS."),
]
HTML_RULES = [
    ("inline-handler", "LOW", r"\son[a-z]+\s*=\s*['\"]", "Inline event handler: blocks a strict CSP; prefer addEventListener."),
    ("blank-noopener", "MEDIUM", r"<a\b(?=[^>]*target=['\"]_blank['\"])(?![^>]*rel=['\"][^'\"]*noopener)[^>]*>",
     "target=_blank without rel=noopener: reverse tabnabbing."),
    ("http-resource", "MEDIUM", r"<(script|link|img|iframe)\b[^>]*(src|href)=['\"]http://", "Resource loaded over plain HTTP."),
    ("javascript-url", "HIGH", r"(href|src)\s*=\s*['\"]\s*javascript:", "javascript: URL: XSS sink."),
]


def scan(folder):
    root = Path(folder)
    findings = []

    def add(rule_id, sev, path, line, msg):
        findings.append({"id": rule_id, "severity": sev, "file": str(path.relative_to(root.parent)).replace("\\", "/"), "line": line, "message": msg})

    for path in sorted(root.rglob("*")):
        if path.is_dir() or any(p in path.parts for p in ("node_modules", ".git", "screenshots")):
            continue
        suffix = path.suffix.lower()
        if suffix not in (".js", ".mjs", ".html", ".htm"):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        rules = JS_RULES + (HTML_RULES if suffix in (".html", ".htm") else [])
        for i, line in enumerate(lines, 1):
            if line.strip().startswith("//"):
                continue
            for rule_id, sev, pat, msg in rules:
                if re.search(pat, line):
                    add(rule_id, sev, path, i, msg)
        if suffix in (".html", ".htm"):
            # Page-level checks.
            if not re.search(r"<meta[^>]+http-equiv=['\"]Content-Security-Policy['\"]", text, re.I):
                add("no-csp", "MEDIUM", path, 1, "No Content-Security-Policy. Add a <meta http-equiv=\"Content-Security-Policy\"> restricting script-src.")
            for m in re.finditer(r"<script\b[^>]*\bsrc=['\"](https?:)?//[^'\"]+['\"][^>]*>", text, re.I):
                if "integrity=" not in m.group(0):
                    add("no-sri", "MEDIUM", path, text[:m.start()].count("\n") + 1,
                        "External script without integrity= (SRI): a compromised CDN could run code. Pin version + add SRI.")
    findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["file"], f["line"]))
    return findings


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    findings = scan(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(findings, indent=1))
    else:
        counts = {s: sum(f["severity"] == s for f in findings) for s in SEVERITY_ORDER}
        print(f"factory-security scan of {sys.argv[1]}: {counts['HIGH']} high, {counts['MEDIUM']} medium, {counts['LOW']} low")
        for f in findings:
            print(f"  [{f['severity']}] {f['file']}:{f['line']} {f['id']}: {f['message']}")
    sys.exit(1 if any(f["severity"] == "HIGH" for f in findings) else 0)


if __name__ == "__main__":
    main()
