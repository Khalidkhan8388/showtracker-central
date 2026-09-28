import { createServerFn } from "@tanstack/react-start";

/** The Google OAuth Client ID is a public identifier (safe in the browser),
 *  but it's stored as a project secret, so we hand it to the client here. */
export const getGoogleClientId = createServerFn({ method: "GET" }).handler(async () => {
  return { clientId: process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "" };
});
