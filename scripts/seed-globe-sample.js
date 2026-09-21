import { openDb } from "../db.js";
import { jevGlobeTick } from "../jev-globe.js";

const now = () => new Date().toISOString();

const SAMPLES = [
  {
    url: "https://example.invalid/rose-sample/ukraine-energy",
    title: "Ukraine energy grid comes under new attacks",
    body: "Ukraine's power network was hit again overnight, leaving cities in the dark and straining repairs before winter. Officials in Kyiv said the country's civilian infrastructure remains a target.",
  },
  {
    url: "https://example.invalid/rose-sample/ukraine-grain",
    title: "Ukraine grain corridor remains blocked",
    body: "Shipments from Ukraine are still stuck as the country struggles to export harvests. Farmers say the blockade is hurting Ukraine's economy.",
  },
  {
    url: "https://example.invalid/rose-sample/japan-growth",
    title: "Japan records strong growth and a calm election",
    body: "Japan posted better-than-expected growth. Voters rewarded continuity, and businesses in Japan described the outlook as stable.",
  },
  {
    url: "https://example.invalid/rose-sample/japan-renewables",
    title: "Japanese cities expand renewable power",
    body: "Cities across Japan added solar and storage, a gain for Japan's energy transition that local governments called a success.",
  },
  {
    url: "https://example.invalid/rose-sample/canada-trade",
    title: "Canada debates mixed results from trade talks",
    body: "Canada's new trade terms help some exporters and hurt others. Economists said the country faces both openings and losses.",
  },
  {
    url: "https://example.invalid/rose-sample/un-roundup",
    title: "UN assembly hears from many capitals",
    body: "Speakers from several continents addressed the general debate. The session ranged across climate, debt, and ceasefires with no single country as the subject. Dateline: New York.",
  },
];

async function main() {
  const db = await openDb();
  const t = now();
  let source = await db.get("SELECT id FROM news_sources ORDER BY id LIMIT 1");
  if (!source) {
    await db.run(
      `INSERT INTO news_sources (
        name, base_url, feed_url, scrape_method, status, priority,
        next_eligible_at, articles_scraped_count, created_at, updated_at
      ) VALUES (?, ?, ?, 'rss', 'paused', 0, ?, 0, ?, ?)`,
      "Rose sample",
      "https://example.invalid",
      null,
      t,
      t,
      t,
    );
    source = await db.get("SELECT id FROM news_sources ORDER BY id LIMIT 1");
  }
  for (const sample of SAMPLES) {
    const existing = await db.get("SELECT id FROM articles WHERE url = ?", sample.url);
    if (existing) continue;
    await db.run(
      `INSERT INTO articles (
        source_id, url, title, body_text, published_at, scraped_at, content_hash,
        lang, raw_metadata, jev_status, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      source.id,
      sample.url,
      sample.title,
      sample.body,
      t,
      t,
      `sample:${sample.url}`,
      "en",
      JSON.stringify({ sample: true }),
      "pending",
      t,
      t,
    );
  }
  const result = await jevGlobeTick(db, { limit: 50 });
  const countries = await db.all(
    `SELECT country_iso, sentiment, eligible, title
     FROM article_geo_sentiment g
     JOIN articles a ON a.id = g.article_id
     WHERE a.url LIKE 'https://example.invalid/rose-sample/%'
     ORDER BY a.id`,
  );
  console.log(JSON.stringify({ seed: result, countries }, null, 2));
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
