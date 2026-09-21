import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENDPOINT = "https://api.typesafe.ai";

export function typesafeKey() {
  return (process.env.TYPESAFE_API_KEY || "").trim();
}

export function typesafeEndpoint() {
  return (process.env.TYPESAFE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, "");
}

/**
 * Live POST /v1/systemone. Request/response fields follow https://docs.typesafe.ai/api.md
 * Do not call this when TYPESAFE_API_KEY is unset — use loadMockAnswers instead.
 */
export async function systemOne({ state, questions, model = "jev-latest" }) {
  const key = typesafeKey();
  if (!key) {
    throw new Error("TYPESAFE_API_KEY is unset; use the mock fixture path.");
  }
  const res = await fetch(`${typesafeEndpoint()}/v1/systemone`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state, model, questions }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`typesafe ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

export async function loadMockAnswers(filename) {
  const file = path.join(ROOT, "fixtures", "jev-mock", filename);
  const raw = JSON.parse(await readFile(file, "utf8"));
  return {
    model: raw.model,
    answers: raw.answers,
    usage: raw.usage || { input_tokens: 0, output_tokens: 0 },
    _mock: true,
  };
}
