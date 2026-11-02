const BASE = "https://api.rodiumai.io/v1";

export function nouvellesStats() {
  return { appels: 0, ms: 0, tokens_in: 0, tokens_out: 0 };
}

// Un appel au modèle. `stats` cumule appels, temps et tokens pour les traces.
export async function appelerLLM(env, messages, { outils, stats } = {}) {
  const debut = Date.now();
  const corps = {
    model: env.MODEL || "anthropic/claude-haiku-5-5",
    messages,
  };
  if (outils && outils.length) corps.tools = outils;

  const rep = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RODIUMAI_API_KEY}`,
    },
    body: JSON.stringify(corps),
  });
  if (!rep.ok) {
    throw new Error(`LLM ${rep.status}: ${(await rep.text()).slice(0, 200)}`);
  }
  const data = await rep.json();
  if (stats) {
    stats.appels += 1;
    stats.ms += Date.now() - debut;
    stats.tokens_in += data.usage?.prompt_tokens || 0;
    stats.tokens_out += data.usage?.completion_tokens || 0;
  }
  return data.choices[0].message;
}