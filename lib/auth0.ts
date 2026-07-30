import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  // This application uses server-side sessions and does not expose Auth0 access
  // tokens to browser code.
  enableAccessTokenEndpoint: false,
});
