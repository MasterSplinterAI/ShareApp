#!/usr/bin/env python3
"""
Translation model latency/throughput benchmark for the caption pipeline.

Measures time-to-first-token (TTFT) and total stream time per model across
representative caption segments and language pairs, using the exact prompt
shape the agent sends (see translation_helpers.build_translation_messages).

Usage:
    venv/bin/python benchmark_translation.py
    venv/bin/python benchmark_translation.py --models gpt-4.1-mini gpt-4.1-nano --runs 5

Requires OPENAI_API_KEY in the environment (or .env).
"""

import argparse
import asyncio
import os
import statistics
import time

from translation_helpers import build_translation_messages

SAMPLE_SEGMENTS = [
    ("en", "Spanish", "Hello everyone, thanks for joining the call today."),
    ("en", "Spanish", "Let's review the quarterly numbers before we move on to the product roadmap."),
    ("en", "French", "Can you hear me okay? My connection dropped for a second."),
    ("en", "German", "We need to finalize the contract terms by the end of next week."),
    ("en", "Japanese", "The new feature will be available to all enterprise customers in June."),
    ("es", "English", "Perfecto, entonces seguimos con el siguiente punto de la agenda."),
]

DEFAULT_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano"]


async def run_one(client, model: str, target_lang_name: str, text: str) -> tuple[float, float, str]:
    """Returns (ttft_ms, total_ms, output)."""
    messages = [
        {"role": role, "content": content}
        for role, content in build_translation_messages(
            target_lang_name=target_lang_name,
            source_text=text,
            context_pairs=[],
            keyterms=[],
        )
    ]
    t0 = time.perf_counter()
    ttft_ms = -1.0
    out = []
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.2,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            if ttft_ms < 0:
                ttft_ms = (time.perf_counter() - t0) * 1000.0
            out.append(delta)
    total_ms = (time.perf_counter() - t0) * 1000.0
    return ttft_ms, total_ms, "".join(out).strip()


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--runs", type=int, default=3, help="runs per segment per model")
    parser.add_argument("--show-output", action="store_true", help="print translations")
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY not set")

    from openai import AsyncOpenAI

    client = AsyncOpenAI()

    print(f"{'model':<16} {'ttft p50':>9} {'ttft p95':>9} {'total p50':>10} {'total p95':>10}  runs")
    for model in args.models:
        ttfts: list[float] = []
        totals: list[float] = []
        for _src, tgt_name, text in SAMPLE_SEGMENTS:
            for _ in range(args.runs):
                try:
                    ttft, total, out = await run_one(client, model, tgt_name, text)
                except Exception as e:  # noqa: BLE001
                    print(f"  {model}: ERROR on {tgt_name!r}: {e}")
                    continue
                if ttft >= 0:
                    ttfts.append(ttft)
                totals.append(total)
                if args.show_output:
                    print(f"  [{model} → {tgt_name}] {out}")
        if not totals:
            print(f"{model:<16} all runs failed")
            continue

        def pct(vals: list[float], p: float) -> float:
            qs = statistics.quantiles(vals, n=100, method="inclusive")
            return qs[min(98, max(0, int(p) - 1))] if len(vals) > 1 else vals[0]

        print(
            f"{model:<16} {pct(ttfts, 50):>8.0f}ms {pct(ttfts, 95):>8.0f}ms "
            f"{pct(totals, 50):>9.0f}ms {pct(totals, 95):>9.0f}ms  {len(totals)}"
        )

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
