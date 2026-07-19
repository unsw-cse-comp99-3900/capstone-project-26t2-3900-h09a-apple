# H09AAPPLE-73 benchmark summary

**Host (this run):** Windows, Node v24.x, Intel i7-class laptop / ~32 GB RAM / discrete GPU.  
**Caveat:** stronger than typical pilot laptops; treat latency as a lower bound.

**Fixtures:** 5 synthetic crops (`fixtures/ground-truth.json`), same images for every engine.

## Measured results

| Engine                     | Role             | Pass       | Cold                | Warm avg         | Cost (this run)                       |
| -------------------------- | ---------------- | ---------- | ------------------- | ---------------- | ------------------------------------- |
| tesseract.js               | Step 1 OCR       | 3/5 (0.60) | ~0.5 s worker load  | ~8-50 ms / image | $0                                    |
| moondream (Ollama)         | Step 2 local VLM | 1/5 (0.20) | ~0.6-9 s first call | ~0.5-0.8 s       | $0                                    |
| openai/gpt-4o (OpenRouter) | Step 2 external  | 5/5 (1.00) | ~0.9-2 s            | ~0.8-1.1 s       | ~$0.004 for 5 calls (~$0.0008 / call) |

Raw JSON: `results/benchmark-latest.json`.

## Decision implication (see design doc §2.5 / §3.5)

1. Adopt local Tesseract.js for Step 1 OCR.
2. Do not default Step 2 to an external vision API (tenant residency / brief).
3. Moondream2 via Ollama is not accurate enough yet for icon fallback on this harness.
4. External GPT-4o is research accuracy ceiling only; production would need opt-in + redaction (§3.5).
