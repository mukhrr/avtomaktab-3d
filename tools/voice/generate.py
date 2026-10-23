"""Builds data/exam/voice-lines.json from the i18n files and renders public/audio/<lang>/<lineId>.mp3 with edge-tts.

Usage: tools/voice/.venv/bin/python tools/voice/generate.py [--lines-only]
"""
import asyncio
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VOICES = {"uz": "uz-UZ-SardorNeural", "ru": "ru-RU-DmitryNeural"}
EXAM_KEYS = [
    "exam.brief", "exam.start", "exam.turnLeftAhead", "exam.turnLeftNow", "exam.turnRightAhead", "exam.turnRightNow",
    "exam.straight", "exam.uturn", "exam.reroute", "exam.finishAhead", "exam.stopHere", "exam.passed", "exam.failed",
]


def spoken_text(text: str) -> str:
    """Drops a trailing ': {var} unit' so numbers are never read out."""
    return re.sub(r"[:,]?\s*\{\w+\}.*$", "", text).strip()


def build_lines() -> dict:
    penalties = json.loads((ROOT / "data/exam/penalties.json").read_text())
    keys = EXAM_KEYS + [f"penalty.{pid}" for pid, p in penalties.items() if p["tier"] in ("high", "fail")]
    strings = {lang: json.loads((ROOT / f"src/i18n/{lang}.json").read_text()) for lang in VOICES}
    lines = {key: {lang: spoken_text(strings[lang][key]) for lang in VOICES} for key in keys}
    out = ROOT / "data/exam/voice-lines.json"
    out.write_text(json.dumps(lines, ensure_ascii=False, indent=2) + "\n")
    return lines


async def render(lines: dict) -> int:
    import edge_tts

    failed = 0
    for lang, voice in VOICES.items():
        folder = ROOT / "public/audio" / lang
        folder.mkdir(parents=True, exist_ok=True)
        for key, texts in lines.items():
            target = folder / f"{key}.mp3"
            if target.exists() and target.stat().st_size > 0:
                continue
            try:
                await edge_tts.Communicate(texts[lang], voice).save(str(target))
                print(f"ok   {lang}/{key}")
            except Exception as e:
                target.unlink(missing_ok=True)
                failed += 1
                print(f"FAIL {lang}/{key}: {e}", file=sys.stderr)
    return failed


if __name__ == "__main__":
    book = build_lines()
    if "--lines-only" in sys.argv:
        sys.exit(0)
    sys.exit(1 if asyncio.run(render(book)) else 0)
