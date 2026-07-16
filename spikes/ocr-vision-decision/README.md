# OCR / vision decision harness (H09AAPPLE-73)

Throwaway benchmark for the §2.5 / §3.5 local-vs-external decision in
`docs/spikes/electron-desktop-capture-review.md`. **Not** part of the monorepo build.

## Candidates

| Engine                              | Role             | How                     |
| ----------------------------------- | ---------------- | ----------------------- |
| `tesseract.js`                      | Step 1 local OCR | npm dependency          |
| `moondream` via Ollama              | Step 2 local VLM | `ollama pull moondream` |
| GPT-4o vision (OpenRouter / OpenAI) | Step 2 external  | reads `apps/api/.env`   |

## Setup

    cd spikes/ocr-vision-decision
    npm install
    # optional local VLM:
    # install Ollama, then: ollama pull moondream

## Run

    npm run benchmark
    npm run benchmark:ocr
    npm run benchmark:ollama
    npm run benchmark:gpt

Results land in `results/benchmark-latest.json` (and a timestamped copy).

## Fixtures

Five synthetic crops in `fixtures/` with pre-written ground truth in
`fixtures/ground-truth.json` (icon-only, small text, clear button, cluttered toolbar,
icon+caption). Regenerate with:

    npm run generate-fixtures

## Scoring

- OCR: pass if all `ocr_expected_contains` tokens appear (icon-only: pass if output is empty/noise).
- Vision: pass if any `vision_expected_contains_any` token appears in the model reply.
- Latency: first call logged as cold; later calls contribute to warm average.
