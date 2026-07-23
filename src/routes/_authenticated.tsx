import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { ensureAuth } from "@/lib/auth";
import { startAutoSync, stopAutoSync } from "@/lib/drive-sync";

export const Route = createFileRoute("/_authenticated")({
  component: LocalGate,
});

function LocalGate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    // Silent anonymous auth — required so per-user Drive connector storage works.
    void ensureAuth().then((uid) => {
      if (uid) startAutoSync();
    });
    return () => stopAutoSync();
  }, []);
  return (
    <div key={pathname} className="route-enter">
      <Outlet />
    </div>
  );
}
