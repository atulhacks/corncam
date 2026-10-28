"""Corncam: deepfake Forger + Detective (image, video, audio, text) for the Deepfake Arena."""

from __future__ import annotations

import argparse
import json
import sys


def _print_card(v) -> None:
    bar = "=" * 72
    print(bar)
    print(f"{v.filename}  [{v.media_type}]  sha256:{v.item_id[:12]}")
    print(f"VERDICT: {v.label.upper()}   confidence {v.confidence:.0%}   tier: {v.tier}   votes: {v.votes}"
          + ("   (experimental)" if v.experimental else ""))
    print(f"REASON [{v.reason_code}]: {v.reason_text}")
    print("-" * 72)
    for s in v.signals:
        score = "  n/a" if s.score is None else f"{s.score:5.2f}"
        t = "" if s.seconds is None else f"  {s.seconds:.2f}s"
        print(f"  {s.category:<14} {s.name:<28} {score}  {s.rank:<9}{t}")
    print(bar)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="corncam", description="Corncam deepfake Detective")
    sub = parser.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect", help="analyse one or more files")
    d.add_argument("paths", nargs="+")
    d.add_argument("--json", action="store_true", help="print verdicts as JSON lines")
    s = sub.add_parser("serve", help="start the local Gradio UI (fallback demo)")
    s.add_argument("--port", type=int, default=7860)
    a = sub.add_parser("api", help="start the HTTP API for the React UI (localhost only)")
    a.add_argument("--port", type=int, default=8000)
    e = sub.add_parser("eval", help="evaluate on a labelled parquet set")
    e.add_argument("parquet")
    e.add_argument("-n", "--per-class", type=int, default=25)
    e.add_argument("--seed", type=int, default=0)
    e.add_argument("--out", default="data/eval/report.json")
    ef = sub.add_parser("eval-folder", help="evaluate on <folder>/real and <folder>/fake")
    ef.add_argument("folder")
    ef.add_argument("--out", default="data/eval/folder_report.json")
    c = sub.add_parser("calibrate", help="fit Platt calibration on a tuning report, check on a held-out report")
    c.add_argument("tune_report")
    c.add_argument("validate_report")
    c.add_argument("--dry-run", action="store_true", help="report only, do not write calibration.json")
    args = parser.parse_args(argv)

    if args.cmd == "calibrate":
        from corncam.calibrate import fit

        print(json.dumps(fit(args.tune_report, args.validate_report, write=not args.dry_run), indent=2))
        return 0

    if args.cmd == "eval-folder":
        from corncam.evaluate import run_folder

        r = run_folder(args.folder, args.out)
        print(json.dumps({k: v for k, v in r.items() if k != "rows"}, indent=2))
        return 0

    if args.cmd == "eval":
        from corncam.evaluate import run

        r = run(args.parquet, args.per_class, args.seed, args.out)
        summary = {k: v for k, v in r.items() if k != "rows"}
        print(json.dumps(summary, indent=2))
        return 0

    if args.cmd == "api":
        from corncam.api import serve as serve_api

        serve_api(port=args.port)
        return 0

    if args.cmd == "serve":
        from corncam.app import serve

        serve(port=args.port)
        return 0

    from corncam.detect import detect

    exit_code = 0
    for path in args.paths:
        try:
            verdict = detect(path)
        except Exception as exc:  # noqa: BLE001 - batch CLI: one bad file must not abort the rest
            print(f"error: {path}: {exc}", file=sys.stderr)
            exit_code = 1
            continue
        if args.json:
            print(json.dumps(verdict.to_dict(), default=str))
        else:
            _print_card(verdict)
    return exit_code
