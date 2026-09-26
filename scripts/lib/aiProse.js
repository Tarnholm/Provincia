/**
 * Plain-English prose for the RIS wiki, written by Claude from COMPUTED facts and the mod's
 * own script code.
 *
 * WHY A MODEL AT ALL. The generators compute every fact (settlements, factions, chances,
 * turns, money, armies) from the mod files, and a rule-based translator turns simple script
 * conditions into English. What rules cannot do is say what a pile of flags is FOR: the Roman
 * civil wars are ~5,000 lines of counters, and "cw1_resolved = 1 and cw1_landed = 1" only
 * means "the first civil war is decided" to someone who has read all of it. The mod team
 * asked for pages a non-coder can read, so that step is handed to a model.
 *
 * WHAT KEEPS IT HONEST.
 *   - The model is given the facts and the code, told to use nothing else, and to write for
 *     players (no counter names, no code).
 *   - Every number in its answer is checked against the numbers in its input (facts, code,
 *     and a turn/year table the generator precomputes). A number that appears nowhere in the
 *     input is treated as invented: the answer is sent back once with the list, and if it
 *     still fails the page is written from the fallback text and the run says so.
 *   - Answers are CACHED and committed (scripts/ai-prose/<kind>/<key>.json), keyed by a hash
 *     of the full input. The model runs only when the facts or the code behind a page change;
 *     every other rebuild reads the cache, costs nothing and produces identical pages, and
 *     each AI-written paragraph is reviewable in git history.
 *   - No credentials (no ANTHROPIC_API_KEY and no `ant auth login` profile)? Nothing breaks:
 *     cached prose is used where it exists, and pages without it use their fallback.
 *
 * Model: Claude Opus 5.5, adaptive thinking (always on for this model), effort "high".
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MODEL = "claude-opus-5-5";
const CACHE_ROOT = path.join(__dirname, "..", "ai-prose");
// Bump when the instructions below change in a way that should rewrite every page.
const PROMPT_VERSION = 1;

const SYSTEM = `You write pages for the player wiki of "RTR: Imperium Surrectum" (RIS), a large mod for Rome: Total War Remastered.

Your readers are PLAYERS, not modders. Most have never opened a script file. Write so they understand what happens in their campaign and what they can do about it.

You are given:
- FACTS: computed from the mod's data files by a program. They are correct. Use them as given.
- CODE: the part of the mod's campaign script that implements the thing you describe, with line numbers. Read it to understand the mechanics. Comments in the code are often out of date: when a comment and the code disagree, the CODE is right.
- TURNS: a table converting the script's internal turn numbers into the turn and year the player sees. Always use the table; never convert turns yourself.

Rules:
1. Use only what the FACTS and CODE show. Do not add history, lore, strategy advice or guesses. If the code does not settle something, leave it out.
2. No code words. Never write counter names, script commands, file names, faction keys (like roman_rebels_1) or condition names. Say what they mean in game terms ("once the first civil war is decided", "a 35% chance each turn").
3. Numbers: every number you write must come from the FACTS, the CODE or the TURNS table. Chances, turn counts, settlement counts, money - copy them, do not round or derive new ones. Say turns as "turn 100 (246 BC)" using the table.
4. Only describe what can actually happen in a campaign. Leave out commented-out code, conditions that can never be met, and branches that are unreachable. If the FACTS mark something as dead or impossible, do not describe it.
5. Say who it applies to. If something happens only when a human plays a certain faction, or only when the AI runs it, say so plainly.
6. Plain, short sentences. British spelling. No headings inside fields, no bullet characters inside strings - lists are given as arrays.
7. Faction and settlement names: use the display names given in the FACTS, never the internal keys.`;

// ── credentials and client ───────────────────────────────────────────────────
let client = null, clientError = null;
function getClient() {
  if (client || clientError) return client;
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const C = Anthropic.default || Anthropic;
    // Zero-arg: resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
    client = new C({ maxRetries: 3 });
  } catch (e) {
    clientError = e;
  }
  return client;
}
const haveCredentials = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE
  || fs.existsSync(path.join(require("os").homedir(), ".config", "anthropic")));

// ── numbers check ────────────────────────────────────────────────────────────
const numbersIn = (s) => new Set((String(s).replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []).map((x) => String(Number(x))));
function inventedNumbers(answer, input) {
  const allowed = numbersIn(input);
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") { for (const n of numbersIn(v)) if (!allowed.has(n) && Number(n) > 10) out.push(n); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(answer);
  return [...new Set(out)];
}

// ── the call ─────────────────────────────────────────────────────────────────
async function ask(input, schema, feedback) {
  const c = getClient();
  const messages = [{ role: "user", content: input }];
  if (feedback) messages.push({ role: "assistant", content: feedback.previous }, { role: "user", content: feedback.note });
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 32000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    messages,
  });
  if (res.stop_reason === "refusal") throw new Error(`refused: ${res.stop_details ? res.stop_details.category : "no detail"}`);
  if (res.stop_reason === "max_tokens") throw new Error("answer cut off at max_tokens");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { json: JSON.parse(text), raw: text, usage: res.usage };
}

/**
 * Prose for one page.
 *   kind     "revolts" | "reforms" ...   (cache folder)
 *   key      page key                    (cache file)
 *   task     what to write, in words
 *   facts    object of computed facts    (serialised as JSON)
 *   code     code excerpt with line numbers
 *   turns    { engineTurn: "turn X (Y BC)" }
 *   schema   JSON schema for the answer  (all objects additionalProperties:false, all keys required)
 * Returns { prose, source: "cache" | "model" | null, note }
 */
function buildInput({ task, facts, code, turns }) {
  return [
    `TASK\n${task}`,
    `FACTS\n${JSON.stringify(facts, null, 1)}`,
    `TURNS (script turn number -> what the player sees)\n${Object.entries(turns || {}).map(([k, v]) => `${k} -> ${v}`).join("\n") || "(none)"}`,
    `CODE\n${code}`,
  ].join("\n\n");
}
// The CODE block quotes script lines with their line numbers, so four lines added at the top of
// the campaign script (2026-09-26: a table-of-contents entry) re-hashed all ten revolts although
// none of their code changed. The numbers are left out of the hash: the prose never cites them,
// and the text they number is still hashed in full.
const stripLineNumbers = (v) => (typeof v === "string" ? v.replace(/^\d+: /gm, "")
  : Array.isArray(v) ? v.map(stripLineNumbers)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripLineNumbers(x)])) : v);
const hashOf = (schema, input) => crypto.createHash("sha256").update(JSON.stringify({ v: PROMPT_VERSION, model: MODEL, system: SYSTEM, schema, input: stripLineNumbers(input) })).digest("hex").slice(0, 16);

/**
 * Prose written outside the build (in a Claude Code session, from the same SYSTEM, TASK and
 * input): run through the same numbers check and stored in the same cache, keyed by the same
 * hash, so the build cannot tell it from a model call - and a later change to the code behind
 * the page still invalidates it.
 */
function storeProse({ kind, key, task, facts, code, turns, schema }, prose, writtenBy) {
  const input = buildInput({ task, facts, code, turns });
  const bad = inventedNumbers(prose, input);
  if (bad.length) return { ok: false, note: `numbers not in the input: ${bad.join(", ")}` };
  const missing = (schema.required || []).filter((k) => !(k in prose));
  if (missing.length) return { ok: false, note: `missing fields: ${missing.join(", ")}` };
  const file = path.join(CACHE_ROOT, kind, `${key}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hash: hashOf(schema, input), model: writtenBy || MODEL, written: new Date().toISOString().slice(0, 10), prose }, null, 1) + "\n", "utf8");
  return { ok: true };
}

async function writeProse({ kind, key, task, facts, code, turns, schema }) {
  const input = [
    `TASK\n${task}`,
    `FACTS\n${JSON.stringify(facts, null, 1)}`,
    `TURNS (script turn number -> what the player sees)\n${Object.entries(turns || {}).map(([k, v]) => `${k} -> ${v}`).join("\n") || "(none)"}`,
    `CODE\n${code}`,
  ].join("\n\n");
  const hash = hashOf(schema, input);
  const file = path.join(CACHE_ROOT, kind, `${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cached.hash === hash) return { prose: cached.prose, source: "cache" };
  } catch { /* no cache yet */ }

  if (!haveCredentials() || !getClient()) {
    return { prose: null, source: null, note: "no Anthropic credentials (set ANTHROPIC_API_KEY or run `ant auth login`) and no cached prose for this input" };
  }
  let { json, raw, usage } = await ask(input, schema);
  let bad = inventedNumbers(json, input);
  if (bad.length) {
    ({ json, raw, usage } = await ask(input, schema, {
      previous: raw,
      note: `These numbers in your answer do not appear anywhere in the FACTS, CODE or TURNS: ${bad.join(", ")}. Rewrite the answer using only numbers from the input (convert turns only via the TURNS table). Same JSON shape.`,
    }));
    bad = inventedNumbers(json, input);
  }
  if (bad.length) return { prose: null, source: null, note: `answer used numbers not in the input (${bad.join(", ")}) twice - not published` };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ hash, model: MODEL, written: new Date().toISOString().slice(0, 10), prose: json }, null, 1) + "\n", "utf8");
  return { prose: json, source: "model", note: usage ? `${usage.input_tokens} in / ${usage.output_tokens} out` : "" };
}

module.exports = { writeProse, storeProse, buildInput, SYSTEM, MODEL, haveCredentials };
