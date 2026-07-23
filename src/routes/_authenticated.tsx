import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  component: LocalGate,
});

function LocalGate() {
  // Local-only app: no auth. Just render the outlet with a keyed fade
  // so route changes still animate smoothly.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={pathname} className="route-enter">
      <Outlet />
    </div>
  );
}
