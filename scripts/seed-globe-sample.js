import { openBackend } from "../backend.js";
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
  const api = await openBackend();
  const t = now();
  let sources = await api.listSources();
  let source = sources[0];
  if (!source) {
    source = await api.createSource({
      name: "Rose sample",
      base_url: "https://example.invalid",
      feed_url: "https://example.invalid/rss.xml",
      scrape_method: "rss",
      status: "paused",
      priority: 0,
    });
  }
  for (const sample of SAMPLES) {
    await api.insertArticle({
      source_id: source.id,
      url: sample.url,
      title: sample.title,
      body_text: sample.body,
      published_at: t,
      scraped_at: t,
      content_hash: `sample:${sample.url}`,
      lang: "en",
      raw_metadata: JSON.stringify({ sample: true }),
      jev_status: "pending",
    });
  }
  const result = await jevGlobeTick(api, { limit: 50 });
  const countries = await api.globe();
  console.log(JSON.stringify({ seed: result, countries }, null, 2));
  await api.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
