import { createFileRoute, redirect } from "@tanstack/react-router";
import { ONBOARDING_KEY } from "./onboarding";

export const Route = createFileRoute("/")({
  // Client-only gate — onboarding state lives in localStorage.
  ssr: false,
  beforeLoad: () => {
    let onboarded = false;
    try {
      onboarded = typeof window !== "undefined" && localStorage.getItem(ONBOARDING_KEY) === "done";
    } catch {}
    throw redirect({ to: onboarded ? "/home" : "/onboarding" });
  },
});
