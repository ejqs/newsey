/** Country coloring for the public globe. Keep in sync with rose-web-public lib/globe-tone.ts. */

export const NET_TONE_THRESHOLD = 0.35;

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function signedSentiment(sentiment, confidence) {
  const c = Number(confidence) || 0;
  if (sentiment === "positive") return c;
  if (sentiment === "negative") return -c;
  return 0;
}

export function aggregateCountryTones(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.country_iso && !row.countryIso) continue;
    const eligible = row.eligible ?? row.eligibleFlag;
    if (eligible === 0 || eligible === false) continue;
    const iso = String(row.country_iso || row.countryIso).toUpperCase();
    const name = row.country_name || row.countryName || iso;
    const conf = Number(row.confidence) || 0;
    const cur = map.get(iso) || { name, n: 0, confSum: 0, net: 0 };
    cur.n += 1;
    cur.confSum += conf;
    cur.net += signedSentiment(row.sentiment, conf);
    if (!cur.name) cur.name = name;
    map.set(iso, cur);
  }
  const maxN = Math.max(1, ...[...map.values()].map((v) => v.n));
  return [...map.entries()]
    .map(([iso, v]) => {
      const avgConf = v.n ? v.confSum / v.n : 0;
      const tone = v.net > NET_TONE_THRESHOLD ? "positive" : v.net < -NET_TONE_THRESHOLD ? "negative" : "neutral";
      const strength = clamp((v.n / maxN) * (0.35 + 0.65 * avgConf), 0.22, 1);
      return {
        iso,
        name: v.name,
        tone,
        net: Math.round(v.net * 1000) / 1000,
        articles: v.n,
        strength: Math.round(strength * 1000) / 1000,
      };
    })
    .sort((a, b) => b.articles - a.articles || a.iso.localeCompare(b.iso));
}

export function capColor(tone, strength) {
  const a = 0.55 + 0.4 * (Number(strength) || 0);
  if (tone === "positive") return `rgba(46, 196, 92, ${a})`;
  if (tone === "negative") return `rgba(220, 50, 50, ${a})`;
  return `rgba(56, 120, 220, ${a})`;
}
