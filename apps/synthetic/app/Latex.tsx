"use client";

import katex from "katex";

export default function Latex({ tex, block = false }: { tex: string; block?: boolean }) {
  return (
    <span
      className={block ? "latex latex-block" : "latex"}
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(tex, {
          displayMode: block,
          throwOnError: false,
          strict: false,
        }),
      }}
    />
  );
}
