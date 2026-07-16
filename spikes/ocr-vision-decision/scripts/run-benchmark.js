/**
 * H09AAPPLE-73 throwaway benchmark.
 *
 * Candidates:
 *   - tesseract  : local OCR (Step 1 crop text)
 *   - moondream  : local VLM via Ollama (Step 2 fallback)
 *   - gpt4o      : external vision API (OpenAI-compatible / OpenRouter)
 *
 * Usage:
 *   node scripts/run-benchmark.js
 *   node scripts/run-benchmark.js --only=tesseract,gpt4o
 *
 * Loads API keys from apps/api/.env (OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL).
 * Never prints secret values.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorker } from 'tesseract.js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const RESULTS = path.join(ROOT, 'results');
const RAW = path.join(RESULTS, 'raw');

const REPO_ROOT = path.resolve(ROOT, '../..');
dotenv.config({ path: path.join(REPO_ROOT, 'apps/api/.env') });

const VISION_PROMPT =
  'You are identifying a single UI control in a desktop screenshot crop. ' +
  'A red circle marks the click target when present. ' +
  'Reply with ONLY a short label for that control (2-4 words max), lowercase. ' +
  'Examples: delete, continue, insert, share, advanced settings. No punctuation.';

function parseOnly() {
  const arg = process.argv.find((item) => item.startsWith('--only='));
  if (!arg) {
    return new Set(['tesseract', 'moondream', 'gpt4o']);
  }
  return new Set(
    arg
      .slice('--only='.length)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAll(haystack, needles) {
  const text = normalize(haystack);
  return needles.every((needle) => text.includes(normalize(needle)));
}

function containsAny(haystack, needles) {
  const text = normalize(haystack);
  return needles.some((needle) => text.includes(normalize(needle)));
}

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

async function runTesseract(cases) {
  const rows = [];
  const coldStart = nowMs();
  const worker = await createWorker('eng');
  const coldMs = nowMs() - coldStart;

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const imagePath = path.join(FIXTURES, item.file);
    const started = nowMs();
    const { data } = await worker.recognize(imagePath);
    const latencyMs = nowMs() - started;
    const text = data.text || '';
    const pass =
      item.ocr_expected_contains.length === 0
        ? normalize(text).length < 8
        : containsAll(text, item.ocr_expected_contains);

    rows.push({
      case_id: item.id,
      category: item.category,
      output: text.trim(),
      latency_ms: latencyMs,
      cold_start_ms: index === 0 ? coldMs : null,
      pass,
      scoring_note:
        item.ocr_expected_contains.length === 0
          ? 'icon_only: pass if OCR output is empty/noise (<8 normalized chars)'
          : 'requires all ocr_expected_contains tokens',
    });
  }

  await worker.terminate();
  return { engine: 'tesseract.js', role: 'step1_ocr', cold_start_ms: coldMs, rows };
}

function ollamaAvailable() {
  const probe = spawnSync('ollama', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function ensureMoondream() {
  const listed = spawnSync('ollama', ['list'], { encoding: 'utf8' });
  if (listed.status !== 0) {
    return { ok: false, error: listed.stderr || listed.stdout || 'ollama list failed' };
  }
  if (!/moondream/i.test(listed.stdout)) {
    console.log('[moondream] pulling moondream via ollama...');
    const pull = spawnSync('ollama', ['pull', 'moondream'], {
      encoding: 'utf8',
      stdio: 'inherit',
    });
    if (pull.status !== 0) {
      return { ok: false, error: 'ollama pull moondream failed' };
    }
  }
  return { ok: true };
}

async function callOllamaVision(imagePath) {
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const started = nowMs();
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'moondream',
      prompt: VISION_PROMPT,
      images: [b64],
      stream: false,
    }),
  });
  const latencyMs = nowMs() - started;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return { output: String(body.response || '').trim(), latencyMs };
}

async function runMoondream(cases) {
  if (!ollamaAvailable()) {
    return {
      engine: 'moondream2@ollama',
      role: 'step2_vision_local',
      skipped: true,
      skip_reason: 'ollama CLI not installed or not on PATH',
      rows: [],
    };
  }

  const ready = ensureMoondream();
  if (!ready.ok) {
    return {
      engine: 'moondream2@ollama',
      role: 'step2_vision_local',
      skipped: true,
      skip_reason: ready.error,
      rows: [],
    };
  }

  spawnSync('ollama', ['list'], { encoding: 'utf8' });

  const rows = [];
  let coldMs = null;

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const imagePath = path.join(FIXTURES, item.file);
    try {
      const { output, latencyMs } = await callOllamaVision(imagePath);
      if (index === 0) {
        coldMs = latencyMs;
      }
      rows.push({
        case_id: item.id,
        category: item.category,
        output,
        latency_ms: latencyMs,
        cold_start_ms: index === 0 ? coldMs : null,
        pass: containsAny(output, item.vision_expected_contains_any),
      });
    } catch (error) {
      rows.push({
        case_id: item.id,
        category: item.category,
        output: '',
        latency_ms: null,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const warm = rows
    .slice(1)
    .filter((row) => row.latency_ms != null)
    .map((row) => row.latency_ms);
  return {
    engine: 'moondream2@ollama',
    role: 'step2_vision_local',
    cold_start_ms: coldMs,
    warm_latency_ms_avg: warm.length
      ? Math.round(warm.reduce((a, b) => a + b, 0) / warm.length)
      : null,
    rows,
  };
}

async function callGptVision({ apiKey, baseUrl, model, imagePath }) {
  const bytes = fs.readFileSync(imagePath);
  const b64 = bytes.toString('base64');
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const started = nowMs();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${b64}` },
            },
          ],
        },
      ],
    }),
  });
  const latencyMs = nowMs() - started;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || JSON.stringify(body).slice(0, 200);
    throw new Error(`GPT vision HTTP ${response.status}: ${message}`);
  }

  const output = body?.choices?.[0]?.message?.content?.trim() || '';
  const usage = body?.usage || {};
  return { output, latencyMs, usage };
}

async function runGpt4o(cases) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  const baseUrl =
    process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  if (!apiKey) {
    return {
      engine: 'gpt-4o-vision',
      role: 'step2_vision_external',
      skipped: true,
      skip_reason: 'OPENAI_API_KEY / OPENROUTER_API_KEY not set',
      rows: [],
    };
  }

  const rows = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    const imagePath = path.join(FIXTURES, item.file);
    try {
      const { output, latencyMs, usage } = await callGptVision({
        apiKey,
        baseUrl,
        model,
        imagePath,
      });
      promptTokens += usage.prompt_tokens || 0;
      completionTokens += usage.completion_tokens || 0;
      rows.push({
        case_id: item.id,
        category: item.category,
        output,
        latency_ms: latencyMs,
        cold_start_ms: index === 0 ? latencyMs : null,
        pass: containsAny(output, item.vision_expected_contains_any),
        usage,
      });
    } catch (error) {
      rows.push({
        case_id: item.id,
        category: item.category,
        output: '',
        latency_ms: null,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const warm = rows
    .slice(1)
    .filter((row) => row.latency_ms != null)
    .map((row) => row.latency_ms);
  const estimatedUsd = (promptTokens / 1_000_000) * 2.5 + (completionTokens / 1_000_000) * 10;

  return {
    engine: model,
    role: 'step2_vision_external',
    base_url_host: (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return 'unknown';
      }
    })(),
    cold_start_ms: rows[0]?.latency_ms ?? null,
    warm_latency_ms_avg: warm.length
      ? Math.round(warm.reduce((a, b) => a + b, 0) / warm.length)
      : null,
    token_usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    estimated_cost_usd_this_run: Number(estimatedUsd.toFixed(4)),
    rows,
  };
}

function summarize(result) {
  if (result.skipped) {
    return { ...result, pass_rate: null };
  }
  const total = result.rows.length;
  const passed = result.rows.filter((row) => row.pass).length;
  return {
    ...result,
    pass_count: passed,
    case_count: total,
    pass_rate: total ? Number((passed / total).toFixed(2)) : null,
  };
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const groundTruth = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'ground-truth.json'), 'utf8'));
  const only = parseOnly();
  const cases = groundTruth.cases;

  const runMeta = {
    card: 'H09AAPPLE-73',
    started_at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    // Keep hardware class only - do not record hostname or exact CPU model.
    cpu_class: 'dev-laptop',
    cpu_count: os.cpus()?.length,
    total_mem_gb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    hostname: 'redacted',
    engines_requested: [...only],
  };

  const results = { meta: runMeta, engines: [] };

  if (only.has('tesseract')) {
    console.log('[run] tesseract.js ...');
    results.engines.push(summarize(await runTesseract(cases)));
  }
  if (only.has('moondream')) {
    console.log('[run] moondream via ollama ...');
    results.engines.push(summarize(await runMoondream(cases)));
  }
  if (only.has('gpt4o')) {
    console.log('[run] gpt-4o vision ...');
    results.engines.push(summarize(await runGpt4o(cases)));
  }

  results.meta.finished_at = new Date().toISOString();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS, `benchmark-${stamp}.json`);
  const latestPath = path.join(RESULTS, 'benchmark-latest.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(RESULTS, 'run-meta.json'), JSON.stringify(runMeta, null, 2));

  console.log('\n=== Summary ===');
  for (const engine of results.engines) {
    if (engine.skipped) {
      console.log(`- ${engine.engine}: SKIPPED (${engine.skip_reason})`);
      continue;
    }
    console.log(
      `- ${engine.engine}: pass ${engine.pass_count}/${engine.case_count}` +
        ` (rate ${engine.pass_rate})` +
        (engine.cold_start_ms != null ? ` cold=${engine.cold_start_ms}ms` : '') +
        (engine.warm_latency_ms_avg != null ? ` warm_avg=${engine.warm_latency_ms_avg}ms` : '') +
        (engine.estimated_cost_usd_this_run != null
          ? ` est_cost=$${engine.estimated_cost_usd_this_run}`
          : ''),
    );
  }
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
