"""Corncam Detective web UI (Gradio). Runs locally; nothing is uploaded anywhere."""

from __future__ import annotations

import json

import gradio as gr

from corncam.detect import detect
from corncam.schema import Rank

CATEGORY_LABEL = {
    "provenance": "Provenance",
    "generative_ai": "Generative AI",
    "faces": "Faces",
    "visual_noise": "Visual noise",
    "voice": "Voice",
    "semantic": "Semantic",
}
TIER_BADGE = {Rank.HIGH: "🔴 Substantial evidence of manipulation",
              Rank.UNCERTAIN: "🟡 Uncertain",
              Rank.LOW: "🟢 Little evidence of manipulation"}


def analyse(path: str | None):
    if not path:
        return None, "", "", [], ""
    v = detect(path)
    label = {"fake": v.p_fake, "real": 1 - v.p_fake}
    headline = (f"### Verdict: **{v.label.upper()}** · {v.confidence:.0%} confidence\n"
                f"{TIER_BADGE[v.tier]} · {v.votes} detector vote(s)"
                + (" · ⚠️ experimental media type" if v.experimental else ""))
    reason = f"**Reason [{v.reason_code}]**\n\n{v.reason_text}"
    cards = [[CATEGORY_LABEL.get(str(s.category), str(s.category)), s.name,
              "n/a" if s.score is None else f"{s.score:.0%}", str(s.rank), s.evidence] for s in v.signals]
    return label, headline, reason, cards, json.dumps(v.to_dict(), indent=2, default=str)


def build() -> gr.Blocks:
    with gr.Blocks(title="Corncam Detective") as demo:
        gr.Markdown("# Corncam Detective\nDrop an image, video, audio clip or text file. "
                    "Every verdict shows its evidence and confidence. Runs fully offline.")
        with gr.Row():
            with gr.Column(scale=1):
                file_in = gr.File(label="Evidence item", type="filepath")
                run_btn = gr.Button("Analyse", variant="primary")
            with gr.Column(scale=2):
                headline = gr.Markdown()
                probs = gr.Label(label="Fused probability", num_top_classes=2)
                reason = gr.Markdown()
        cards = gr.Dataframe(headers=["Category", "Detector", "P(fake)", "Rank", "Evidence"],
                             label="Evidence cards", wrap=True, interactive=False)
        with gr.Accordion("Raw verdict JSON", open=False):
            raw = gr.Code(language="json")
        run_btn.click(analyse, inputs=file_in, outputs=[probs, headline, reason, cards, raw])
    return demo


def serve(host: str = "127.0.0.1", port: int = 7860) -> None:
    build().launch(server_name=host, server_port=port, share=False)
