#!/usr/bin/env python3
"""Convert an ICSI Meeting Corpus transcript (.mrt) into an AFK.ai meeting JSON file.

The ICSI corpus (CC BY 4.0, https://groups.inf.ed.ac.uk/ami/icsi/) ships human
transcripts as XML: one <Segment> per utterance with StartTime, EndTime and an
anonymous Participant code such as "me013". This script is the corpus-specific
half of the import (F0). It produces the neutral meeting format the app and the
AI step consume; the app validates that format again with Zod on load.

Usage:
  python3 tools/icsi/parse_mrt.py data/icsi-source Bmr007 data/meetings

Decisions, in code comments where they apply:
  - DigitTask segments are dropped: they are the corpus's digit-reading exercise,
    not meeting content.
  - Segments with no words (coughs, laughter only) are dropped.
  - Speakers keep their anonymous corpus code and get a stable display label
    ("Speaker A".. in order of first appearance). Real names were never recorded.
  - Overlapping speech is kept as-is (half of consecutive turns overlap in this
    corpus); turns are ordered by (startSec, endSec).
  - Titles are the corpus's research-group names, not invented topics. Dates are the
    corpus's DateTimeStamp in Berkeley local time, written as ISO 8601 with offset.
Python 3.9+, standard library only.
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo

# Session prefix -> the research group that held the meeting (corpus documentation).
_GROUP_TITLES = {
    "Bmr": "Meeting Recorder project meeting",
    "Bro": "Robustness group meeting",
    "Bed": "Even Deeper Understanding group meeting",
}

# Inline markup inside a segment: keep spoken words, drop annotator noise.
_KEEP_TEXT_OF = {"Emphasis", "Pronounce", "Uncertain"}  # the words were said
_DROP = {"VocalSound", "NonVocalSound", "Comment", "Pause"}  # not words


def segment_text(seg):
    parts = [seg.text or ""]
    for child in seg:
        if child.tag in _KEEP_TEXT_OF:
            parts.append("".join(child.itertext()))
        parts.append(child.tail or "")
    text = " ".join("".join(parts).split())
    # Transcriber conventions (doc/trans_guide.txt): spoken letters are capitals
    # followed by "_" ("I_B_M", "O_K"); "@@" is unintelligible speech; a word
    # ending in "-" was cut off, and a lone " - " is a restart.
    text = re.sub(r"(?<=[A-Z])_", "", text)
    text = text.replace("@@", "[unclear]")
    text = re.sub(r"\s+-\s+", " – ", text)
    text = text.strip()
    # Nothing but "[unclear]" markers and punctuation is not speech. (An alternation: the
    # earlier character class also dropped short words spelled from those letters, such
    # as "a", "can" and "u-"; data/README.md records that the committed JSON predates this.)
    return "" if re.fullmatch(r"(?:\[unclear\]|[\s,.?!–-])*", text) else text


def recorded_at(stamp):
    """ "2000-11-09-1445" (Berkeley local time) -> "2000-11-09T14:45:00-08:00"."""
    if not stamp:
        return None
    local = datetime.strptime(stamp, "%Y-%m-%d-%H%M").replace(tzinfo=ZoneInfo("America/Los_Angeles"))
    return local.isoformat()


def parse(path):
    root = ET.parse(path).getroot()
    session = root.get("Session")
    notes = " ".join((root.findtext("Preamble/Notes") or "").split())
    turns = []
    for seg in root.iter("Segment"):
        if seg.get("DigitTask") == "true":
            continue
        who = seg.get("Participant")
        start, end = seg.get("StartTime"), seg.get("EndTime")
        if not (who and start and end):
            continue
        text = segment_text(seg)
        if not text:
            continue
        start_s, end_s = float(start), float(end)
        if end_s < start_s:
            raise ValueError("%s: segment ends before it starts at %s" % (session, start))
        turns.append({"speaker": who, "startSec": round(start_s, 3), "endSec": round(end_s, 3), "text": text})
    turns.sort(key=lambda t: (t["startSec"], t["endSec"]))
    labels = {}
    for t in turns:
        if t["speaker"] not in labels:
            n = len(labels)
            labels[t["speaker"]] = "Speaker " + (chr(ord("A") + n) if n < 26 else str(n + 1))
    # Merge consecutive short segments by the same speaker into readable turns.
    merged = []
    for t in turns:
        last = merged[-1] if merged else None
        if last and last["speaker"] == t["speaker"] and t["startSec"] - last["endSec"] <= 1.0 and len(last["text"]) < 400:
            last["endSec"] = max(last["endSec"], t["endSec"])
            last["text"] = (last["text"] + " " + t["text"]).strip()
        else:
            merged.append(dict(t))
    merged.sort(key=lambda t: (t["startSec"], t["endSec"]))
    for i, t in enumerate(merged):
        t["id"] = "%s-%04d" % (session.lower(), i)
    return {
        "id": session.lower(),
        "title": _GROUP_TITLES[session[:3]],
        "source": {
            "corpus": "ICSI Meeting Corpus",
            "session": session,
            "licence": "CC BY 4.0",
            "url": "https://groups.inf.ed.ac.uk/ami/icsi/",
            "modified": "Transcript converted to turns; digit-reading task and non-speech annotations removed.",
            "notes": notes,
        },
        "recordedAt": recorded_at(root.get("DateTimeStamp")),
        "durationSec": round(max(t["endSec"] for t in merged), 3),
        "speakers": [{"code": code, "label": label} for code, label in labels.items()],
        "turns": merged,
    }


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    tdir, mid, out = sys.argv[1:]
    meeting = parse(os.path.join(tdir, mid + ".mrt"))
    os.makedirs(out, exist_ok=True)
    dest = os.path.join(out, meeting["id"] + ".json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(meeting, f, ensure_ascii=False, indent=1)
    words = sum(len(t["text"].split()) for t in meeting["turns"])
    print("%s: %d turns, %d speakers, %.1f min, %d words -> %s" % (
        mid, len(meeting["turns"]), len(meeting["speakers"]), meeting["durationSec"] / 60, words, dest))


if __name__ == "__main__":
    main()
