import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";
import { getCachedPhotoUrl, getPhotoUrl } from "@/lib/photo-cache";

function LocalImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = (props.src as string) || "";
  const isLocal = src.startsWith("local://");
  const [resolved, setResolved] = useState<string>(() =>
    isLocal ? getCachedPhotoUrl(src) ?? "" : src,
  );
  useEffect(() => {
    if (!isLocal) { setResolved(src); return; }
    const cached = getCachedPhotoUrl(src);
    if (cached) { setResolved(cached); return; }
    let cancelled = false;
    getPhotoUrl(src).then((u) => { if (!cancelled) setResolved(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [src, isLocal]);
  if (!resolved) return null;
  return <img {...props} src={resolved} />;
}


export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div
      className={`markdown text-sm leading-relaxed text-foreground [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_p]:whitespace-pre-wrap [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:my-0 [&_a]:underline [&_a]:decoration-foreground/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-foreground [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4 [&_hr]:border-border [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_input[type=checkbox]]:mr-1.5 [&_img]:my-3 [&_img]:rounded-xl ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, children, ...props }) => {
            const href = (props as any).href as string | undefined;
            const isExternal = !!href && /^https?:\/\//i.test(href);
            const isResolvedWiki = !!href && /^\/notes\//.test(href);
            const isUnresolvedWiki = !!href && /^\/search\?q=/.test(href);
            if (isExternal) {
              let host = href!;
              try { host = new URL(href!).hostname.replace(/^www\./, ""); } catch {}
              const label = typeof children === "string" || (Array.isArray(children) && children.every(c => typeof c === "string")) ? children : host;
              return (
                <a
                  {...props}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-yellow-400/20 px-2.5 py-0.5 text-xs font-medium text-yellow-700 no-underline hover:bg-yellow-400/30"
                >
                  <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="h-3 w-3 rounded-sm !my-0" />
                  <span>{label}</span>
                </a>
              );
            }
            if (isResolvedWiki) {
              return (
                <a
                  {...props}
                  className="inline-flex items-center rounded-full bg-yellow-400/25 px-2.5 py-0.5 text-xs font-medium text-yellow-800 no-underline ring-1 ring-yellow-400/60 shadow-[0_0_12px_rgba(250,204,21,0.55)] hover:bg-yellow-400/35"
                >
                  {children}
                </a>
              );
            }
            if (isUnresolvedWiki) {
              return (
                <a
                  {...props}
                  className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground no-underline ring-1 ring-border hover:bg-muted/80"
                >
                  {children}
                </a>
              );
            }
            return <a {...props} target="_blank" rel="noreferrer">{children}</a>;
          },
          img: (props) => <LocalImg {...(props as any)} />,
        }}


      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
