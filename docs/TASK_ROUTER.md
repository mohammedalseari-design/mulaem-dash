# Task: effort router for the import agent

Owner decisions (27 Sep 2026):

- Default model: **DeepSeek V4.1 Flash**. Reasoning (thinking) is switched on only when the effort score says so.
- Escalate only after **two failed Flash attempts**, or when the employee ticks **«تفكير عميق»**:
  - **GPT-6 Astra** for reasoning-type failures and for every deep request.
  - **Claude Opus 5.5** for everything else (format and evidence failures), and for requests that contain PDFs or images.
- All three go through **OpenRouter** with one key, `OPENROUTER_API_KEY`, which the owner adds himself as a Supabase Edge
  Function secret. Never ask for it, print it, log it or commit it. `ANTHROPIC_API_KEY` is no longer needed.
- Unchanged: drafts only, manager approval, evidence rules, the suspicious-text scan, claim/lease, cancellation.

Work only in `C:\Users\Mohammed\Projects\mulaem-dash`. Commit only this task's files with explicit `git add <paths>`.
The folder has unrelated uncommitted changes (including `CNAME` and `crm/index.html`): do not touch, stage or push them.

## 1. Portable router core — `supabase/functions/_shared/effort-router/`

Plain TypeScript and `fetch`, with no Supabase or Deno-only imports, so the same files can later run in Node for the
owner's Local AI Station.

- **`tiers.ts`**: tier config `{ id, model, baseUrl, apiKeyEnv, reasoningStyle, supportsFiles, location: "cloud" | "local", provider? }`.
  Defaults, each overridable by env (`AGENT_MODEL_FAST`, `AGENT_MODEL_REASON`, `AGENT_MODEL_GENERAL`):
  - `fast` → `deepseek/deepseek-v4.1-flash` with
    `provider: { order: [...], allow_fallbacks: false, data_collection: "deny", require_parameters: true }`.
    Build `order` from the providers listed on openrouter.ai/deepseek/deepseek-v4.1-flash that are US companies and
    accept the parameters we send (candidates: DeepInfra, Fireworks, Together, Baseten). Never DeepSeek's own endpoint or
    any China-hosted provider. Confirm with a live call.
  - `reason` → `openai/gpt-6-astra`, `reasoning: { effort: "high" }`.
  - `general` → `anthropic/claude-opus-5.5`, reasoning with a token budget (`reasoning: { max_tokens }`).
- **`effort.ts`**: `scoreEffort(input) → { score, reasons }`. Deterministic, with no model call. Inputs:
  - request kind
  - source kinds
  - total text length
  - count of numbers
  - payment-plan keywords (دفعة، دفعات، أقساط، سعر المتر، %)
  - number of unit/model mentions

  Starting weights:

  | Signal | Points |
  |---|---|
  | Update request | +2 |
  | Text over 15k chars | +1 |
  | Text over 60k chars | +2 |
  | More than 40 numbers | +1 |
  | More than 150 numbers | +2 |
  | Payment-plan keywords present | +1 |
  | 5 or more unit/model mentions | +1 |

  Reasoning is on when `score >= AGENT_REASONING_THRESHOLD` (default 3). Return the reasons so they are logged and the
  threshold can be tuned from real outcomes.
- **`ladder.ts`**:
  - **First tier:** a `deep` request goes to `reason`. A request with any PDF or image source goes to `general`. Everything else goes to `fast`, with reasoning set by the score.
  - **Attempt 2:** if the first `fast` attempt fails, run `fast` again with reasoning on and a repair prompt.
  - **Attempt 3:** if attempt 2 fails, escalate to `reason` when the failure class is `reasoning`, otherwise to `general`.
  - **Stop:** if an escalated attempt fails, the request fails and the validator's messages are kept for a human to review.
  - **Limits:** at most 3 model attempts per run. These are separate from the existing request-level retries for infrastructure errors.
- **`classify.ts`**: `classifyFailure(result) → "format" | "evidence" | "reasoning"`.
  - `format`: JSON parse error, truncated output (`finish_reason` = `length`), schema or type errors, zero evidenced fields.
  - `evidence`: quote missing, or quote not found in the source text.
  - `reasoning`: numeric range rejections, cross-field inconsistency (price / area / price per metre), conflicting values
    across sources, unit-matching ambiguity in update requests.

  Add an optional `code` to the validator's `Conflict` entries so classification never parses Arabic notes.

  A run counts as failed in two cases:
  - on a hard failure;
  - when rejected fields exceed `AGENT_MAX_REJECT_RATIO` (default `0.3`) of the fields the model returned.

  Values the model marks `inferred`, and missing fields, are not failures.
- **`client.ts`**: OpenAI-compatible `chat()` via `fetch` to `https://openrouter.ai/api/v1/chat/completions`.
  - **Response format:** send `response_format: { type: "json_schema", json_schema: { name, strict, schema } }`. If the `fast` tier cannot be routed with it, fall back to `{ type: "json_object" }` with the schema in the prompt; validation catches the rest.
  - **Reasoning styles:**
    - `openrouter`: `reasoning: { enabled: false }`, `{ effort }` or `{ max_tokens }`.
    - `ollama`, `llamacpp`, `vllm`: stubs for local servers (see §6).
  - **Output budget:** raise `max_tokens` when reasoning is on, because reasoning tokens count toward it.
  - **Return value:** `{ text, finishReason, usage: { prompt, completion, reasoning, costUsd } }`, with the cost taken from OpenRouter's `usage.cost`.
- **`redact.ts`**: replace phone numbers and e-mails in text with stable placeholders (`[PHONE_1]`, `[EMAIL_1]`).
  - Cover Saudi and international phone formats, with spaces or dashes, and Arabic-Indic digits (reuse `asciiDigits`).
  - Keep the placeholder map in memory only.
  - `restore()` puts the originals back.
- **Policy:** `localOnly: true` removes every `cloud` tier (for data that must not leave the machine).
- **Tests:** `deno test` for scoring, ladder transitions, classification and the redaction round-trip.

## 2. agent-run integration

- **Replace the Anthropic SDK call** with the router loop, and convert the `loadSources` blocks to OpenAI-style parts:
  - text as text parts;
  - images as `image_url` data URLs;
  - PDFs as `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,..." } }`, for the `general` tier only.

  Test that Opus reads a PDF natively through OpenRouter. If it doesn't, use
  `plugins: [{ id: "file-parser", pdf: { engine: "pdf-text" } }]`, and `mistral-ocr` only when `pdf-text` returns almost no
  text.
- **Redact before every call:**
  - Redact text sources before every model call.
  - Validate evidence against the redacted text.
  - Restore the placeholders in proposed values and quotes before saving drafts, then normalise phones as today.
  - PDFs and images cannot be redacted, which is one more reason they go only to the `general` tier.
- **Repair prompt** (attempt 2 onwards): the validator's messages, in Arabic, plus "return corrected JSON only".
- **Input cap:** `countTokens` is Anthropic-only. Estimate tokens as chars/3 against `MAX_INPUT_TOKENS` before calling, keep `MAX_TEXT_CHARS`, and store the real `prompt_tokens` afterwards.
- **`status`:** reports enabled if and only if `OPENROUTER_API_KEY` is set. Update the Arabic disabled message to name the new secret.
- **Usage:** keep `tokens_used`, and add cost.

## 3. Budget and logging — migration `022_agent_router.sql` (apply with the Supabase MCP)

- **New table `agent_model_calls`:**

  | Column | Definition |
  |---|---|
  | `id` | primary key |
  | `request_id` | references `agent_requests`, on delete cascade |
  | `attempt` | `int` |
  | `tier` | `text` |
  | `model` | `text` |
  | `reasoning` | `text` |
  | `effort_score` | `int` |
  | `effort_reasons` | `text[]` |
  | `prompt_tokens` | `int` |
  | `completion_tokens` | `int` |
  | `reasoning_tokens` | `int` |
  | `cost_usd` | `numeric(10,6)` |
  | `outcome` | `text`, check in `('ok','invalid','error')` |
  | `failure_class` | `text` |
  | `created_at` | `timestamptz`, default `now()` |

  RLS on: admins read, inserts only from the service role, no client writes.
- **New column** `agent_requests.effort_hint text not null default 'auto' check (effort_hint in ('auto','deep'))`.
- **Settings** in `crm_settings`, admin-editable: `agent_daily_usd_cap` (default `2`) and `agent_daily_escalations` (default `10`).
  - Before every model call, check today's (Asia/Riyadh) `sum(cost_usd)` and the escalation count. The count covers escalated attempts plus deep requests.
  - Stop with a clear Arabic message when either cap is hit.
  - Keep `agent_daily_cap()` (request count) as it is.

## 4. UI — `crm/js/agent.js`

- A checkbox on the request form: «تفكير عميق (أبطأ وأغلى)» → `effort_hint = 'deep'`.
- In the request details, admins see each attempt: model, reasoning on/off, cost. No other UI changes.

## 5. Verification (once the owner has added the key)

1. `deno test` passes.
2. A short WhatsApp text goes to the `fast` tier with reasoning off, a draft is created, and the cost is logged.
3. A text whose total price contradicts area × price per metre gets two Flash attempts, then Astra, and all three calls are logged.
4. A PDF brochure goes to the `general` tier.
5. One test run with a temporary debug log shows the outgoing payload has no raw phone numbers. Remove the log before committing.
6. Report per-call costs from `agent_model_calls`, and today's total.

## 6. `docs/ROUTER.md` — reuse in the Local AI Station

Explain how to run `_shared/effort-router` outside Supabase:

- **Endpoints:** point the tiers at local OpenAI-compatible servers:
  - Ollama: `http://<host>:11434/v1`
  - LM Studio: `:1234/v1`
  - llama.cpp server
  - vLLM
- **Policy:** set `localOnly: true`.
- **Escalation stays local:** small model → same model with thinking → larger local model → human.
- **Thinking switches differ per server:** Ollama uses `think`; llama.cpp and vLLM use `chat_template_kwargs.enable_thinking` for Qwen3-family models. Check each server's docs before relying on them.
- **Security:** never expose these servers to the internet.
