const BASE = () => {
  const url = process.env.ROSE_BACKEND_URL || "";
  if (!url) throw new Error("ROSE_BACKEND_URL is required. rose-bot no longer uses DATABASE_URL.");
  return url.replace(/\/$/, "");
};

const TOKEN = () => process.env.ROSE_BOT_TOKEN || "";

async function api(method, path, body) {
  const headers = { accept: "application/json" };
  if (TOKEN()) headers.authorization = `Bearer ${TOKEN()}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { ok: false, error: "invalid_json", raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(json.error || `backend_http_${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function openBackend() {
  const health = await api("GET", "/health");
  return {
    label: `rose-backend (${BASE()})`,
    async health() {
      return api("GET", "/health");
    },
    async publicArticles(limit) {
      const r = await api("GET", `/v1/articles?limit=${limit}`);
      return r.articles || [];
    },
    async globe() {
      const r = await api("GET", "/v1/globe");
      return r.countries || [];
    },
    async counts() {
      const h = await this.health();
      return { articles: h.articles, sources: h.sources, globe: h.globe };
    },
    async listSources() {
      const r = await api("GET", "/v1/bot/sources");
      return r.sources || [];
    },
    async eligibleSources(limit) {
      const r = await api("GET", `/v1/bot/sources/eligible?limit=${limit}`);
      return r.sources || [];
    },
    async createSource(fields) {
      const r = await api("POST", "/v1/bot/sources", fields);
      return r.source;
    },
    async patchSource(id, patch) {
      const r = await api("PATCH", `/v1/bot/sources/${id}`, patch);
      return r.source;
    },
    async sourceArticleCount(id) {
      const r = await api("GET", `/v1/bot/sources/${id}/article-count`);
      return Number(r.n || 0);
    },
    async rememberUrl(sourceId, url, outcome, note) {
      const r = await api("PUT", "/v1/bot/ledger", {
        url,
        source_id: sourceId,
        outcome,
        note: note ?? null,
      });
      return r.is_new;
    },
    async insertArticle(fields) {
      return api("POST", "/v1/bot/articles", fields);
    },
    async pendingGeo(limit) {
      const r = await api("GET", `/v1/bot/articles/pending-geo?limit=${limit}`);
      return r.articles || [];
    },
    async upsertJevAnalysis(fields) {
      return api("PUT", "/v1/bot/jev-analyses", fields);
    },
    async upsertGeoSentiment(fields) {
      return api("PUT", "/v1/bot/article-geo-sentiment", fields);
    },
    async setJevStatus(id, jev_status) {
      return api("PATCH", `/v1/bot/articles/${id}`, { jev_status });
    },
    async close() {},
    _boot: health,
  };
}
