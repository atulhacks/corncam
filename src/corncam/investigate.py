"""AI investigator: DeepSeek plans and narrates an investigation by calling our local detectors as tools.

What the AI may do: decide the order of checks, ask for deeper ones (more crops, more video frames, the advisory face
model), and explain what it found. What it may not do: see the media (it gets detector outputs only), skip a core
detector (every core check for the media type runs regardless), or decide the verdict (detect.fuse does, exactly as
for a normal analysis). Without an API key, or if a call fails, the same checks run as a fixed plan.

Events (one JSON object per line, streamed to the Pipeline page):
  {"type": "start", "media_type", "facts"}            file facts
  {"type": "thought", "text"}                         the AI's narration between tool calls
  {"type": "tool", "tool", "args", "lanes", "why"}    a check starts (lanes = Pipeline canvas nodes to light up)
  {"type": "tool_result", "tool", "signals", "seconds"}
  {"type": "verdict", "verdict"}                      fused, calibrated verdict (same as /api/detect)
  {"type": "explanation", ...}                        plain-language explanation (ai.explain) or template text
  {"type": "error", "text"} / {"type": "done"}
"""

from __future__ import annotations

import json
import subprocess
import time
from collections.abc import Iterator
from dataclasses import asdict
from typing import Any

from corncam import ai
from corncam.detect import fuse
from corncam.ingest import Item
from corncam.schema import MediaType, Signal
from corncam.signals import audio, face, image, provenance, video

MAX_STEPS = 8

TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "check_provenance",
        "description": "Read embedded metadata: Content Credentials (C2PA), AI tool names, generator prompts, "
                       "watermark heuristics. Cheap; decisive when a label survives.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "scan_whole_image",
        "description": "Smaug AI-image detector on the whole picture (is it fully AI-generated?). More crops = "
                       "slower but steadier; use 5 when the first result is borderline (0.3-0.7).",
        "parameters": {"type": "object", "properties": {
            "crops": {"type": "integer", "minimum": 1, "maximum": 5, "description": "1, 3 or 5"}}}}},
    {"type": "function", "function": {
        "name": "check_faces",
        "description": "Find every face and score it for swaps or edits (GenD, trusted). include_advisory adds "
                       "DF40, a model trained on modern swaps that is shown but never votes.",
        "parameters": {"type": "object", "properties": {"include_advisory": {"type": "boolean"}}}}},
    {"type": "function", "function": {
        "name": "scan_video_frames",
        "description": "Pick the sharpest, most face-rich frames spread across the video and run the whole-image "
                       "and face detectors on each. 8 frames by default; 16 when results are borderline.",
        "parameters": {"type": "object", "properties": {
            "frames": {"type": "integer", "minimum": 4, "maximum": 16}}}}},
    {"type": "function", "function": {
        "name": "check_voice",
        "description": "Find speech and score it for synthetic voice / cloning (pellav2), window by window.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "finish",
        "description": "Call when the evidence is sufficient. The verdict is then computed from the detector "
                       "results by the fusion step, not by you.",
        "parameters": {"type": "object", "properties": {"reason": {"type": "string"}}}}},
]

# Checks that always run for each media type, whatever the AI chooses (it can add depth, never remove coverage).
CORE: dict[MediaType, list[tuple[str, dict[str, Any]]]] = {
    MediaType.IMAGE: [("check_provenance", {}), ("scan_whole_image", {"crops": 3}), ("check_faces", {})],
    MediaType.VIDEO: [("check_provenance", {}), ("scan_video_frames", {"frames": 8}), ("check_voice", {})],
    MediaType.AUDIO: [("check_provenance", {}), ("check_voice", {})],
    MediaType.TEXT: [("check_provenance", {})],
}
ALLOWED: dict[MediaType, set[str]] = {
    MediaType.IMAGE: {"check_provenance", "scan_whole_image", "check_faces"},
    MediaType.VIDEO: {"check_provenance", "scan_video_frames", "check_voice"},
    MediaType.AUDIO: {"check_provenance", "check_voice"},
    MediaType.TEXT: {"check_provenance"},
}
LANES = {  # Pipeline canvas lane categories each tool lights up
    "check_provenance": ["provenance", "visual_noise"], "scan_whole_image": ["generative_ai"],
    "check_faces": ["faces"], "scan_video_frames": ["generative_ai", "faces"], "check_voice": ["voice"],
}


def facts(item: Item) -> dict[str, Any]:
    """What the AI is told about the file: type and shape only, never content."""
    out: dict[str, Any] = {"media_type": str(item.media_type), "size_kb": round(item.size_bytes / 1024)}
    if item.media_type is MediaType.IMAGE:
        import cv2

        img = cv2.imread(str(item.path), cv2.IMREAD_COLOR)
        if img is not None:
            out["width"], out["height"] = int(img.shape[1]), int(img.shape[0])
            out["faces_found"] = len(face.detect_faces(img))
    elif item.media_type in (MediaType.VIDEO, MediaType.AUDIO):
        out["duration_s"] = round(video.duration(item.path) or 0.0, 1)
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json",
                                str(item.path)], capture_output=True, text=True, check=False)
        try:
            kinds = [s["codec_type"] for s in json.loads(probe.stdout).get("streams", [])]
        except json.JSONDecodeError:
            kinds = []
        out["has_audio"], out["has_video"] = "audio" in kinds, "video" in kinds
    return out


def run_tool(item: Item, name: str, args: dict[str, Any]) -> list[Signal]:
    if name == "check_provenance":
        return provenance.run(item)
    if name == "scan_whole_image":
        crops = int(args.get("crops") or 3)
        return [image.smaug(item, crops=5 if crops >= 4 else 1 if crops <= 1 else 3)]
    if name == "check_faces":
        out = [face.gend_faces(item)]
        if args.get("include_advisory"):
            out.append(face.df40_faces(item))
        return out
    if name == "scan_video_frames":
        return video.run(item, n=max(4, min(int(args.get("frames") or 8), 16)))
    if name == "check_voice":
        return audio.run(item)
    raise ValueError(f"unknown tool {name}")


def _brief(signals: list[Signal]) -> list[dict[str, Any]]:
    """Tool result sent back to the AI: scores and our own findings, nothing else."""
    return [{"detector": s.name, "score": None if s.score is None else round(s.score, 3), "rank": str(s.rank),
             "counts_as": {"trust": "2 votes", "include": "1 vote", "ignore": "shown only"}.get(str(s.policy)),
             "finding": s.evidence} for s in signals]


_SYSTEM = (
    "You are the lead investigator of Corncam, a deepfake detection system. You cannot see the media. You run "
    "detector tools and read their results. Plan briefly, call tools, and react to results: e.g. if a whole-image "
    "score is borderline (0.3-0.7) rescan with 5 crops; if faces were found and the trusted face score is borderline "
    "(0.5-0.85) add the advisory face model; for borderline video scan 16 frames. Before each tool call write ONE "
    "short sentence (max 20 words) saying why, in plain words. Never state a final verdict yourself: call finish "
    "and the fusion step decides. Use only tools that fit the media type."
)


def investigate(item: Item) -> Iterator[dict[str, Any]]:
    signals: dict[str, Signal] = {}
    ran: set[tuple[str, str]] = set()
    f = facts(item)
    yield {"type": "start", "media_type": str(item.media_type), "facts": f}

    def execute(name: str, args: dict[str, Any], why: str) -> Iterator[dict[str, Any]]:
        key = (name, json.dumps(args, sort_keys=True))
        if key in ran:
            return
        ran.add(key)
        yield {"type": "tool", "tool": name, "args": args, "lanes": LANES.get(name, []), "why": why}
        t0 = time.perf_counter()
        new = run_tool(item, name, args)
        for s in new:
            signals[s.name] = s  # a deeper rerun replaces the shallower result of the same detector
        yield {"type": "tool_result", "tool": name, "signals": [asdict(s) for s in new],
               "seconds": round(time.perf_counter() - t0, 2), "_brief": _brief(new)}

    allowed = ALLOWED.get(item.media_type, {"check_provenance"})
    used_ai = ai.configured()
    if used_ai:
        tools = [t for t in TOOLS if t["function"]["name"] in allowed | {"finish"}]
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"Investigate this item. File facts: {json.dumps(f)}"},
        ]
        try:
            for _ in range(MAX_STEPS):
                msg = ai.chat_tools(messages, tools)
                messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")})
                if msg.get("content"):
                    yield {"type": "thought", "text": msg["content"].strip()}
                calls = msg.get("tool_calls") or []
                if not calls:
                    break
                finished = False
                for call in calls:
                    name = call["function"]["name"]
                    try:
                        args = json.loads(call["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    if name == "finish":
                        finished = True
                        result: Any = {"ok": True}
                    elif name not in allowed:
                        result = {"error": f"{name} does not apply to {item.media_type}"}
                    else:
                        brief: list[dict[str, Any]] = []
                        for ev in execute(name, args, msg.get("content") or ""):
                            brief = ev.pop("_brief", brief)
                            yield ev
                        result = brief or {"note": "already run"}
                    messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
                if finished:
                    break
        except ai.AIError as exc:
            yield {"type": "thought", "text": f"AI unavailable ({exc}); finishing with the standard checks."}
            used_ai = False
    else:
        yield {"type": "thought", "text": "AI is not configured, so the standard checks run in a fixed order."}

    # Coverage guarantee: every core check for this media type runs, whatever the AI chose.
    for name, args in CORE.get(item.media_type, [("check_provenance", {})]):
        if not any(r[0] == name for r in ran):
            for ev in execute(name, args, "Required check for this media type."):
                ev.pop("_brief", None)
                yield ev

    verdict = fuse(item, list(signals.values()))
    vd = verdict.to_dict()
    yield {"type": "verdict", "verdict": vd}
    if used_ai:
        try:
            yield {"type": "explanation", **ai.explain(vd)}
        except ai.AIError as exc:
            yield {"type": "error", "text": f"Explanation unavailable: {exc}"}
    else:
        yield {"type": "explanation", "headline": None, "explanation": verdict.reason_text}
    yield {"type": "done"}
