#!/usr/bin/env python3
"""
Evaluation harness for the Claude Intake Triage Assistant.

Runs every sample intake in test_cases.json through Claude, then scores:
  - primary accuracy : did the model pick the right main need?
  - needs coverage    : did it also surface the additional needs present?

Run both prompt versions to reproduce the before/after improvement:

    export ANTHROPIC_API_KEY=sk-ant-...
    python run_evals.py --prompt v1
    python run_evals.py --prompt v2

Results are printed as a table and written to results_<version>.md
"""
import argparse
import json
import os
import sys
from pathlib import Path

try:
    import anthropic
except ImportError:
    sys.exit("Missing dependency. Run:  pip install -r ../requirements.txt")

from prompts import SYSTEMS, build_user, CATEGORIES

HERE = Path(__file__).resolve().parent
DEFAULT_MODEL = "claude-haiku-4-5"   # cheap + fast; swap to claude-sonnet-4-6 for more nuance


def parse_json(text: str) -> dict:
    """Pull a JSON object out of the model output, tolerating stray fences."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.lstrip().lower().startswith("json"):
            text = text.lstrip()[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON object found in: {text[:120]!r}")
    return json.loads(text[start:end + 1])


def predicted_categories(result: dict, version: str):
    """Return (primary, all_predicted_needs) for either schema version."""
    if version == "v1":
        primary = result.get("category", "")
        return primary, [primary]
    primary = result.get("primary_category", "")
    secondary = result.get("secondary_categories", []) or []
    return primary, [primary] + list(secondary)


def call_claude(client, model, system, intake_text):
    msg = client.messages.create(
        model=model,
        max_tokens=600,
        system=system,
        messages=[{"role": "user", "content": build_user(intake_text)}],
    )
    return "".join(block.text for block in msg.content if block.type == "text")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", choices=["v1", "v2"], default="v2")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--limit", type=int, default=0, help="only run first N cases")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY first:  export ANTHROPIC_API_KEY=sk-ant-...")

    cases = json.loads((HERE / "test_cases.json").read_text())["cases"]
    if args.limit:
        cases = cases[: args.limit]

    client = anthropic.Anthropic()
    system = SYSTEMS[args.prompt]

    rows, primary_hits, covered_hits, coverage_total = [], 0, 0, 0

    for c in cases:
        try:
            raw = call_claude(client, args.model, system, c["input"])
            result = parse_json(raw)
            primary, all_preds = predicted_categories(result, args.prompt)
            preds_norm = {p.strip().lower() for p in all_preds}
        except Exception as e:  # noqa: BLE001
            rows.append((c["id"], "ERROR", str(e)[:30], "-", "-"))
            continue

        primary_ok = primary.strip().lower() == c["expected_primary"].strip().lower()
        primary_hits += int(primary_ok)

        expected_needs = {c["expected_primary"].lower()} | {
            s.lower() for s in c.get("expected_secondary", [])
        }
        if len(expected_needs) > 1:               # only score coverage on multi-need cases
            coverage_total += 1
            covered = expected_needs.issubset(preds_norm)
            covered_hits += int(covered)
            cov_mark = "yes" if covered else "NO"
        else:
            cov_mark = "n/a"

        rows.append((c["id"], primary, "PASS" if primary_ok else "FAIL",
                     str(int(result.get("human_review_required", False))), cov_mark))

    # ---- print table ----
    print(f"\nPrompt {args.prompt}  |  model {args.model}\n")
    hdr = f"{'id':<6}{'predicted primary':<34}{'primary':<9}{'review':<8}{'covers needs'}"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        print(f"{r[0]:<6}{r[1]:<34}{r[2]:<9}{r[3]:<8}{r[4]}")

    n = len(cases)
    acc = primary_hits / n * 100 if n else 0
    cov = covered_hits / coverage_total * 100 if coverage_total else 0
    print("-" * len(hdr))
    print(f"primary accuracy : {primary_hits}/{n}  ({acc:.0f}%)")
    print(f"needs coverage   : {covered_hits}/{coverage_total} multi-need cases  ({cov:.0f}%)")
    if args.prompt == "v1":
        print("note: v1 has no secondary field, so multi-need coverage is structurally capped.\n")
    else:
        print()

    # ---- write markdown ----
    out = HERE / f"results_{args.prompt}.md"
    lines = [f"# Eval results — prompt {args.prompt}", "",
             f"- model: `{args.model}`",
             f"- primary accuracy: **{primary_hits}/{n} ({acc:.0f}%)**",
             f"- needs coverage: **{covered_hits}/{coverage_total} ({cov:.0f}%)**", "",
             "| id | predicted primary | primary | human review | covers needs |",
             "|----|-------------------|---------|--------------|--------------|"]
    lines += [f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} |" for r in rows]
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out.name}")


if __name__ == "__main__":
    main()
