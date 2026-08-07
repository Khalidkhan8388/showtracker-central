import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "../components/ui/sonner";
import { ThemeProvider, THEME_BOOT_SCRIPT } from "../lib/theme";
import { ConfirmDialogHost } from "../components/ConfirmDialog";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again or head home.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Braintape" },
      { name: "description", content: "Speak a thought. Braintape transcribes, summarizes, and pulls out your tasks — automatically." },
      { property: "og:title", content: "Braintape" },
      { property: "og:description", content: "Speak a thought. Braintape transcribes, summarizes, and pulls out your tasks — automatically." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Braintape" },
      { name: "twitter:description", content: "Speak a thought. Braintape transcribes, summarizes, and pulls out your tasks — automatically." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2e90f16c-5c06-4f6a-b797-0c5bd1842d0a/id-preview-9b3ab55a--edee8366-bd4b-4df7-854a-68818d6e7bcf.lovable.app-1784630431165.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2e90f16c-5c06-4f6a-b797-0c5bd1842d0a/id-preview-9b3ab55a--edee8366-bd4b-4df7-854a-68818d6e7bcf.lovable.app-1784630431165.png" },
      { name: "theme-color", content: "#ffffff" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Braintape" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" },
    ],


  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>

      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (typeof window === "undefined") return;
    // Never register the SW inside Lovable preview / iframe / dev — it keeps
    // stale HTML around and breaks live editing. Ship it only in the real app.
    const host = window.location.hostname;
    const inIframe = window.self !== window.top;
    const isPreview =
      !import.meta.env.PROD ||
      inIframe ||
      host.startsWith("id-preview--") ||
      host.startsWith("preview--") ||
      host === "lovableproject.com" ||
      host.endsWith(".lovableproject.com") ||
      host === "lovableproject-dev.com" ||
      host.endsWith(".lovableproject-dev.com") ||
      host === "beta.lovable.dev" ||
      host.endsWith(".beta.lovable.dev") ||
      new URLSearchParams(window.location.search).get("sw") === "off";
    if (isPreview) {
      navigator.serviceWorker.getRegistrations?.().then((regs) => {
        regs.forEach((r) => {
          if (r.active?.scriptURL.endsWith("/sw.js")) r.unregister().catch(() => {});
        });
      }).catch(() => {});
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});

    // Ask once for notification permission so the SW can post a background
    // "Saved to Braintape" status when a share arrives while the app is closed.
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch {}

    // Background share intake — when the SW receives a Web Share Target POST
    // it postMessages us; drain the inbox silently instead of navigating the
    // user to /share.
    const onMessage = async (ev: MessageEvent) => {
      if (ev.data?.type !== "braintape-share-received") return;
      try {
        const { drainAndSaveShares } = await import("@/lib/share-inbox");
        const { toast } = await import("sonner");
        const n = await drainAndSaveShares();
        if (n > 0) toast.success(n === 1 ? "Saved to Braintape" : `Saved ${n} items`);
      } catch {
        // silent — user will see any failed items on next /share visit
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    // On startup, drain anything left over from a share that happened while
    // the app wasn't open.
    (async () => {
      try {
        const { drainAndSaveShares } = await import("@/lib/share-inbox");
        await drainAndSaveShares();
      } catch {}
      try {
        const { pruneDuplicateNotes } = await import("@/lib/dedupe");
        await pruneDuplicateNotes();
      } catch {}
    })();

    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Outlet />
        <ConfirmDialogHost />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}


