"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// v3.9: articles render on the CLIENT with react-markdown. This replaces the
// v3.8 server-side Markdown→HTML render that failed inside Vercel's serverless
// bundle (ESM-only `marked`) and shipped raw `###` to the reader. One path
// renders all three stored shapes — Markdown (Jina fallback / pasted / edited),
// sanitized HTML (strong extraction), and the HTML+Markdown mix Jina sometimes
// returns: remark parses Markdown, rehype-raw parses embedded HTML, and
// rehype-sanitize enforces a strict allow-list. react-markdown builds React
// elements (no dangerouslySetInnerHTML), so with sanitize it is safe by
// construction and fixes every already-stored item with no migration.

// Allow-list mirrors lib/extract.ts ARTICLE_ALLOWED_TAGS: the safe default plus
// figure/figcaption (article captions) and a `loading` attr on images.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "figure", "figcaption"],
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), "loading"],
  },
};

// Hotlinked images are proxied so they load over our HTTPS origin (defeats
// mixed-content) and with a same-origin Referer (defeats hotlink protection) —
// see app/api/img/route.ts. The <img> src rewrite happens after sanitize has
// already validated the original absolute URL as http(s).
function proxied(src: string): string {
  return `/api/img?url=${encodeURIComponent(src)}`;
}

const components: Components = {
  img(props) {
    const src = typeof props.src === "string" ? props.src : "";
    if (!src) return null;
    const url = /^https?:\/\//i.test(src) ? proxied(src) : src;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={typeof props.alt === "string" ? props.alt : ""} loading="lazy" />;
  },
  a(props) {
    return (
      <a href={typeof props.href === "string" ? props.href : undefined} target="_blank" rel="noreferrer">
        {props.children}
      </a>
    );
  },
};

export default function ArticleMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}
