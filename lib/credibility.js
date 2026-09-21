import { stripWww, hostOf } from "./urls.js";

/** Conservative English-language newsrooms. Domain match is required to scrape. */
export const NEWS_PUBLISHERS = [
  { name: "BBC", domains: ["bbc.com", "bbc.co.uk", "bbci.co.uk"] },
  { name: "NPR", domains: ["npr.org"] },
  { name: "The Guardian", domains: ["theguardian.com"] },
  { name: "Al Jazeera", domains: ["aljazeera.com"] },
  { name: "Reuters", domains: ["reuters.com"] },
  { name: "AP News", domains: ["apnews.com"] },
  { name: "PBS", domains: ["pbs.org"] },
  { name: "CBC", domains: ["cbc.ca"] },
  { name: "ABC Australia", domains: ["abc.net.au"] },
  { name: "The Associated Press", domains: ["ap.org"] },
  { name: "Deutsche Welle", domains: ["dw.com"] },
  { name: "France 24", domains: ["france24.com"] },
  { name: "The New York Times", domains: ["nytimes.com"] },
  { name: "Washington Post", domains: ["washingtonpost.com"] },
  { name: "Wall Street Journal", domains: ["wsj.com"] },
  { name: "Financial Times", domains: ["ft.com"] },
  { name: "The Economist", domains: ["economist.com"] },
  { name: "CNN", domains: ["cnn.com"] },
  { name: "NBC News", domains: ["nbcnews.com"] },
  { name: "CBS News", domains: ["cbsnews.com"] },
  { name: "ABC News", domains: ["abcnews.go.com", "abcnews.com"] },
  { name: "Politico", domains: ["politico.com"] },
  { name: "The Atlantic", domains: ["theatlantic.com"] },
  { name: "USA Today", domains: ["usatoday.com"] },
  { name: "Los Angeles Times", domains: ["latimes.com"] },
  { name: "The Independent", domains: ["independent.co.uk"] },
  { name: "The Telegraph", domains: ["telegraph.co.uk"] },
  { name: "Sydney Morning Herald", domains: ["smh.com.au"] },
  { name: "The Hindu", domains: ["thehindu.com"] },
  { name: "Japan Times", domains: ["japantimes.co.jp"] },
  { name: "Euronews", domains: ["euronews.com"] },
  { name: "The Globe and Mail", domains: ["theglobeandmail.com"] },
  { name: "Global News", domains: ["globalnews.ca"] },
  { name: "Time", domains: ["time.com"] },
];

function hostMatchesDomain(host, domain) {
  const h = stripWww(host);
  const d = stripWww(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

export function publisherForHost(host, extraDomains = []) {
  const h = stripWww(host);
  for (const pub of NEWS_PUBLISHERS) {
    if (pub.domains.some((d) => hostMatchesDomain(h, d))) return pub;
  }
  for (const d of extraDomains) {
    if (hostMatchesDomain(h, d)) return { name: d, domains: [d], extra: true };
  }
  return null;
}

export function isNewsHost(urlOrHost, extraDomains = [], sourceHosts = []) {
  const host = urlOrHost.includes("://") ? hostOf(urlOrHost) : stripWww(urlOrHost);
  if (publisherForHost(host, extraDomains)) return true;
  return sourceHosts.some((s) => hostMatchesDomain(host, s));
}

export function sourceHostsFromRows(sources) {
  const hosts = [];
  for (const s of sources || []) {
    for (const raw of [s.base_url, s.feed_url]) {
      const h = hostOf(raw || "");
      if (h) hosts.push(h);
    }
  }
  return [...new Set(hosts)];
}

export function pausedHostsFromRows(sources) {
  return sourceHostsFromRows((sources || []).filter((s) => s.status === "paused" || s.status === "robots_disallow"));
}
