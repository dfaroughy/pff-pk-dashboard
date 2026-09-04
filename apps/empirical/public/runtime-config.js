window.PFF_DASHBOARD_CONFIG = window.PFF_DASHBOARD_CONFIG || {
  apiRoot: window.location.hostname === "dfaroughy.github.io"
    ? "https://dariusfar-pff-pk-api.hf.space"
    : "http://127.0.0.1:8791",
  corpusPath: "data/corpus.json",
};
