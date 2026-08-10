/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudbeds credentials are read server-side only — never exposed to the client.
  // snowflake-sdk is a Node driver (native-ish deps); keep it out of the bundle
  // so the /api/cron/elise-sync route can require it at runtime.
  serverExternalPackages: ["snowflake-sdk"],
  // The KB corpus is read from disk at runtime (lib/kb-corpus.ts). Next traces
  // static imports, not readFileSync of a computed path, so without this the
  // markdown is simply missing from the deployment and /kb renders an empty
  // corpus in production while working locally. Fixtures are excluded — they are
  // test data and must never ship.
  outputFileTracingIncludes: {
    "/kb": ["./content/kb/*.md"],
    "/kb/[slug]": ["./content/kb/*.md"],
  },
};

export default nextConfig;
