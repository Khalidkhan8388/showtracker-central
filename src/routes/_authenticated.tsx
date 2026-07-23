import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthGate,
});

function AuthGate() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) navigate({ to: "/auth" });
      else setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!mounted) return;
      if (!session) navigate({ to: "/auth" });
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return <AnimatedOutlet />;
}

function AnimatedOutlet() {
  // Use the top-level matched pathname so nested param changes still transition
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Group by section so scroll within same section doesn't re-animate awkwardly
  const key = pathname.split("/").slice(0, 3).join("/") || "/";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -6, filter: "blur(6px)" }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{ willChange: "opacity, transform, filter" }}
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}
