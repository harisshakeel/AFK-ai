#!/usr/bin/env python3
"""Capture each prompt and its final response into .agent-logs/.

Wired from .claude/settings.json; argv[1] names the event:
  session-start  SessionStart        remember the session's model
  prompt         UserPromptSubmit    append a PROMPT entry (`prompt`, verbatim)
  response       Stop / StopFailure  append a RESPONSE entry (`last_assistant_message`)

One file per session: .agent-logs/YYYY-MM-DD_HH-MM-SS_<session-id>.md (UTC of the
first prompt). Entries are append-only; only the frontmatter counters are rewritten.

The first time a session is seen with no log yet (hooks installed mid-session),
earlier turns are backfilled from the session transcript and marked as such.

Stdlib only. Never blocks the session: on any failure it exits 0 and emits a
systemMessage so a broken capture is visible rather than silent.
"""
import fcntl
import glob
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone

AUTHOR = "harisshakeel"
TOOL = "claude-code"
FM_KEYS = ["session_id", "date", "author", "model", "tool", "project",
           "total_exchanges", "first_prompt_time", "last_prompt_time"]
BACKFILLED = "source: backfilled from transcript (hook was not active yet)"
INTERRUPTED = "status: no Stop event fired (turn interrupted); text is the last assistant message in the transcript"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------- transcript ----------

def read_transcript(path):
    entries = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    pass
    except (OSError, TypeError):
        pass
    return entries


def is_human_prompt(e):
    return (e.get("type") == "user" and not e.get("isSidechain") and not e.get("isMeta")
            and ((e.get("origin") or {}).get("kind") == "human" or bool(e.get("turnPosition"))))


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    for b in content or []:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text", ""))
        elif isinstance(b, dict) and b.get("type") == "image":
            parts.append("[image]")
    return "\n".join(parts)


def transcript_turns(entries):
    """One dict per human prompt: the prompt entry plus the text of the turn's last assistant message."""
    turns = []
    for e in entries:
        if is_human_prompt(e):
            turns.append({"prompt": e, "msg_id": None, "blocks": [], "ts": None, "model": None})
        elif turns and e.get("type") == "assistant" and not e.get("isSidechain"):
            m = e.get("message") or {}
            t = turns[-1]
            if m.get("id") != t["msg_id"]:
                t["msg_id"], t["blocks"] = m.get("id"), []
            t["blocks"] += [b.get("text", "") for b in m.get("content") or []
                            if isinstance(b, dict) and b.get("type") == "text"]
            t["ts"] = e.get("timestamp") or t["ts"]
            if m.get("model") and m["model"] != "<synthetic>":
                t["model"] = m["model"]
    return turns


def last_model(entries):
    for e in reversed(entries):
        m = e.get("message") if e.get("type") == "assistant" and not e.get("isSidechain") else None
        if isinstance(m, dict) and m.get("model") and m["model"] != "<synthetic>":
            return m["model"]
    return None


# ---------- state (gitignored; per-session bookkeeping the log format has no room for) ----------

def load_state(state_dir, sid):
    try:
        with open(os.path.join(state_dir, sid + ".json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state_dir, sid, st):
    path = os.path.join(state_dir, sid + ".json")
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)
    os.replace(path + ".tmp", path)


# ---------- log file ----------

class Log:
    def __init__(self, log_dir, sid, project):
        self.sid, self.short, self.project = sid, sid[:8], project
        existing = sorted(glob.glob(os.path.join(log_dir, "*_" + sid + ".md")))
        self.log_dir = log_dir
        self.path = existing[0] if existing else None
        self.is_new = not existing
        self.fm, self.body = {}, ""
        if self.path:
            with open(self.path, encoding="utf-8") as f:
                text = f.read()
            end = text.find("\n---\n", 4)
            for line in text[4:end].splitlines():
                k, _, v = line.partition(": ")
                self.fm[k] = v
            self.body = text[end + len("\n---\n"):]

    def entry(self, kind, ts, model, text, extra=()):
        if kind == "PROMPT":
            n = int(self.fm.get("total_exchanges") or 0) + 1
            if not self.path:
                stamp = ts[:19].replace("T", "_").replace(":", "-")
                self.path = os.path.join(self.log_dir, f"{stamp}_{self.sid}.md")
                self.fm = {"session_id": self.sid, "date": ts[:10], "author": AUTHOR, "model": model,
                           "tool": TOOL, "project": self.project, "total_exchanges": "0",
                           "first_prompt_time": ts, "last_prompt_time": ts}
                self.body = (f"\n# Session Log - {ts[:10]}\n\n"
                             f"Session: `{self.short}` | Project: `{self.project}` | Author: `{AUTHOR}`\n\n---\n\n")
            self.fm["total_exchanges"] = str(n)
            self.fm["last_prompt_time"] = ts
        else:
            n = int(self.fm.get("total_exchanges") or 0)
        head = [f"[LOG_ENTRY type={kind} num={n} session={self.short}]", f"timestamp: {ts}", f"model: {model}", *extra]
        self.body += "\n".join(head) + "\n\n" + text + "\n\n\n"

    def save(self, models):
        if not self.path:
            return
        if models:
            self.fm["model"] = ", ".join(models)
        fm = "---\n" + "".join(f"{k}: {self.fm.get(k, '')}\n" for k in FM_KEYS) + "---\n"
        with open(self.path + ".tmp", "w", encoding="utf-8") as f:
            f.write(fm + self.body)
        os.replace(self.path + ".tmp", self.path)


def note_model(st, model):
    if model and model != "unknown" and model not in st.setdefault("models", []):
        st["models"].append(model)


def backfill(log, st, turns, fallback_model):
    for t in turns:
        p = t["prompt"]
        model = t["model"] or fallback_model
        log.entry("PROMPT", p.get("timestamp") or utc_now(), model,
                  text_of((p.get("message") or {}).get("content")), [BACKFILLED])
        if t["msg_id"]:
            log.entry("RESPONSE", t["ts"] or utc_now(), model, "\n".join(t["blocks"]), [BACKFILLED])
            note_model(st, t["model"])


# ---------- events ----------

def on_session_start(inp, st, log):
    if inp.get("model"):
        st["model"] = inp["model"]


def on_prompt(inp, st, log):
    entries = read_transcript(inp.get("transcript_path"))
    model = last_model(entries) or st.get("model") or "unknown"
    prompt, pid = inp.get("prompt", ""), inp.get("prompt_id")
    turns = transcript_turns(entries)
    if log.is_new:
        # Drop the current prompt if the transcript already holds it.
        if turns and (turns[-1]["prompt"].get("promptId") == pid
                      or (not turns[-1]["msg_id"]
                          and text_of((turns[-1]["prompt"].get("message") or {}).get("content")).strip() == prompt.strip())):
            turns = turns[:-1]
        backfill(log, st, turns, model)
    elif st.get("open"):
        prev = next((t for t in reversed(turns) if t["prompt"].get("promptId") == st.get("last_prompt_id")), None)
        text = "\n".join(prev["blocks"]) if prev else ""
        log.entry("RESPONSE", (prev and prev["ts"]) or utc_now(), (prev and prev["model"]) or model, text, [INTERRUPTED])
        note_model(st, prev and prev["model"])
    log.entry("PROMPT", utc_now(), model, prompt)
    if not st.get("models"):
        log.fm["model"] = model
    st.update(open=True, last_prompt_id=pid)


def on_response(inp, st, log):
    entries = read_transcript(inp.get("transcript_path"))
    model = last_model(entries) or st.get("model") or "unknown"
    if log.is_new:
        # Hook went live mid-turn: pull earlier turns plus this turn's prompt from the transcript.
        turns = transcript_turns(entries)
        backfill(log, st, turns[:-1], model)
        if turns:
            p = turns[-1]["prompt"]
            log.entry("PROMPT", p.get("timestamp") or utc_now(), model,
                      text_of((p.get("message") or {}).get("content")), [BACKFILLED])
    extra = []
    if inp.get("hook_event_name") == "StopFailure":
        extra.append(f"status: turn ended on API error ({inp.get('error') or 'unknown'})")
    log.entry("RESPONSE", utc_now(), model, inp.get("last_assistant_message") or "", extra)
    note_model(st, model)
    st["open"] = False


HANDLERS = {"session-start": on_session_start, "prompt": on_prompt, "response": on_response}


def main():
    event = sys.argv[1] if len(sys.argv) > 1 else ""
    inp = json.loads(sys.stdin.read() or "{}")
    sid = inp.get("session_id") or ""
    if event not in HANDLERS or inp.get("agent_id") or not re.fullmatch(r"[0-9A-Za-z_-]+", sid):
        return
    root = os.environ.get("CLAUDE_PROJECT_DIR") or inp.get("cwd") or os.getcwd()
    log_dir = os.environ.get("CAPTURE_LOG_DIR") or os.path.join(root, ".agent-logs")
    state_dir = os.environ.get("CAPTURE_STATE_DIR") or os.path.join(root, ".claude", "hooks", ".state")
    os.makedirs(log_dir, exist_ok=True)
    os.makedirs(state_dir, exist_ok=True)
    with open(os.path.join(state_dir, sid + ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        st = load_state(state_dir, sid)
        log = Log(log_dir, sid, os.path.basename(os.path.abspath(root)))
        HANDLERS[event](inp, st, log)
        log.save(st.get("models"))
        save_state(state_dir, sid, st)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # never block the session; make the failure visible instead
        try:
            root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
            with open(os.path.join(root, ".claude", "hooks", ".state", "capture-errors.log"), "a", encoding="utf-8") as f:
                f.write(f"{utc_now()} {sys.argv[1:]}\n{traceback.format_exc()}\n")
        except Exception:
            pass
        print(json.dumps({"systemMessage": f"[agent-log capture] failed: {exc!r}"}))
    sys.exit(0)
