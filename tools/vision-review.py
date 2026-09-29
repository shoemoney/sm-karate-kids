#!/usr/bin/env python3
"""
Vision review harness.

Sends real screenshots of the running game to a state-of-the-art vision model
on OpenRouter and asks for exactly 5 concrete improvements, each with a reason
and an actionable suggestion. Used by the improvement loop in REVIEW-LOOP.md.

Usage:
  python3 tools/vision-review.py <model-id> <shotdir> [--out review.json]

Reads every PNG in <shotdir>, downsizes to a sane vision input size, and sends
them as one multi-image turn.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

PROMPT = """You are an advisory reviewer with eyes on a real, shipping game. This is \
"SM Karate Kids" - a twin-stick point-karate bout for mobile, running in a browser \
with WebGPU, built on Three.js. Portrait phone (390x844) is the design baseline.

You are being shown real screenshots captured from the running game. Judge what \
you can SEE, not what the source code might do. Be specific: name the screen, the \
region, and the pixel-level problem.

The game currently: renders a 3D dojo (generated backdrop, tatami floor, crowd \
silhouettes, banners, volumetric light) with photoreal sprite fighters, a TSL post \
chain (bloom, warm/cool split-tone, film grain, vignette), a warm "tungsten and \
tatami" HUD, and a branded ShoeMoney pre-boot loading screen.

Give EXACTLY 5 improvements. For each:
  - id: short kebab-case slug
  - title: one line
  - what: precisely what you see that is wrong or weak, citing the screenshot
  - why: the concrete reason it hurts the player or the product
  - how: an actionable, specific fix someone could implement today

Rules:
- Rank by real player impact. A thing a player notices in the first 5 seconds \
beats a nit.
- Be concrete and visual. "Composition is weak" is useless. "The fighters sit in \
the lower third with a third of the frame being empty mat below them" is useful.
- Do not invent problems you cannot see evidence for.
- If something is genuinely good, do not pad the list with praise.
- Respect the deliberate art direction: a warm, low-key, cinematic dojo at night \
is the intent, not a bug. Do not suggest making it brighter or more neutral.
- The game is touch-first on a phone. Judge it as a phone game.

Return ONLY a JSON array of 5 objects with keys: id, title, what, why, how.
No prose, no markdown fence, no preamble."""


def encode(path, max_edge=1280):
    from PIL import Image  # noqa: PLC0415

    img = Image.open(path).convert("RGB")
    w, h = img.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    import io

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("shotdir")
    ap.add_argument("--out")
    ap.add_argument("--key-file", default=os.path.expanduser("~/.config/openrouter/key"))
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key and os.path.exists(args.key_file):
        key = open(args.key_file).read().strip()
    if not key:
        print("no API key", file=sys.stderr)
        return 2

    shots = sorted(
        os.path.join(args.shotdir, f)
        for f in os.listdir(args.shotdir)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    )
    if not shots:
        print(f"no images in {args.shotdir}", file=sys.stderr)
        return 2

    content = [{"type": "text", "text": PROMPT}]
    for path in shots:
        try:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{encode(path)}"},
                }
            )
        except Exception as exc:  # noqa: BLE001
            print(f"skip {path}: {exc}", file=sys.stderr)

    body = json.dumps(
        {
            "model": args.model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.4,
            # Reasoning models spend most of this budget thinking and then run
            # out mid-JSON. 3000 was not enough: gemini-3.8-flash burned 2877
            # tokens on reasoning and was truncated at 2996.
            "max_tokens": 12000,
        }
    ).encode()

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/shoemoney/sm-karate-kids",
            "X-Title": "SM Karate Kids vision review",
        },
    )

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:600]
        print(f"HTTP {exc.code}: {detail}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"request failed: {exc}", file=sys.stderr)
        return 1

    elapsed = time.time() - started
    text = payload["choices"][0]["message"]["content"]
    usage = payload.get("usage", {})

    parsed = None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(
            line for line in cleaned.splitlines() if not line.strip().startswith("```")
        )
    # Models routinely emit a short preamble before the array, or trailing prose
    # after it. Try the whole thing first, then the outermost [ ... ] span.
    for candidate in (cleaned, None):
        if candidate is None:
            start, end = cleaned.find("["), cleaned.rfind("]")
            if start == -1 or end <= start:
                continue
            candidate = cleaned[start : end + 1]
        try:
            found = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(found, list) and found:
            parsed = found
            break

    result = {
        "model": args.model,
        "elapsed_s": round(elapsed, 1),
        "usage": usage,
        "shots": [os.path.basename(s) for s in shots],
        "items": parsed,
        "raw": None if parsed else text,
    }
    if args.out:
        with open(args.out, "w") as fh:
            json.dump(result, fh, indent=2)

    if parsed:
        print(f"OK {args.model} — {len(parsed)} items in {elapsed:.0f}s "
              f"({usage.get('total_tokens', '?')} tokens)")
        for item in parsed:
            print(f"  - {item.get('id')}: {item.get('title')}")
    else:
        print(f"NO-JSON {args.model} in {elapsed:.0f}s — raw saved to {args.out}")
        print(text[:800])
    return 0 if parsed else 1


if __name__ == "__main__":
    raise SystemExit(main())
