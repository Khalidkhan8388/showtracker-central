import { useEffect, useState } from "react";
import { getCachedPhotoUrl, getPhotoUrl } from "@/lib/photo-cache";

// Resolves `local://images/...` paths to blob URLs on the fly so markdown-embedded
// images survive reloads (blob: URLs stored in text don't). Non-local URLs pass through.
export function useResolvedImageSrc(src: string | undefined): string {
  const initial = !src ? "" : src.startsWith("local://") ? getCachedPhotoUrl(src) ?? "" : src;
  const [url, setUrl] = useState(initial);
  useEffect(() => {
    if (!src) { setUrl(""); return; }
    if (!src.startsWith("local://")) { setUrl(src); return; }
    const cached = getCachedPhotoUrl(src);
    if (cached) { setUrl(cached); return; }
    let cancelled = false;
    void getPhotoUrl(src).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [src]);
  return url;
}

export function LocalImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const resolved = useResolvedImageSrc(typeof props.src === "string" ? props.src : undefined);
  if (!resolved) return null;
  return <img {...props} src={resolved} />;
}
