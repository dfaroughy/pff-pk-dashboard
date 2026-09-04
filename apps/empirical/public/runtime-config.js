window.PFF_DASHBOARD_CONFIG = window.PFF_DASHBOARD_CONFIG || {
  apiRoot: ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://127.0.0.1:8791"
    : "https://dariusfar-pff-pk-api.hf.space",
  corpusPath: "data/corpus.json",
};
