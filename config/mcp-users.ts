// The people we hand MCP connector URLs to (spec 2026-08-12 §6).
//
// A dropdown on /connectors rather than a free-text box: mcp_tokens.email
// exists only so Kyle can tell whose URL is whose, and a typo silently
// corrupts exactly that. "Other" on the form still allows a free-text address
// for someone not on this list.
export const MCP_USERS: { email: string; name: string }[] = [
  { email: "rb@rise8companies.com", name: "Rob" },
  { email: "bke@rentstayable.com", name: "Kyle" },
  { email: "cj@rentstayable.com", name: "Crystal" },
  { email: "kate@rentstayable.com", name: "Kate" },
  { email: "bea@rentstayable.com", name: "Bea" },
  { email: "monica@rentstayable.com", name: "Monica" },
  { email: "jefferson@rentstayable.com", name: "Jefferson" },
  { email: "gerardo@rentstayable.com", name: "Gerardo" },
];
