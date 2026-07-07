/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudbeds credentials are read server-side only — never exposed to the client.
  // snowflake-sdk is a Node driver (native-ish deps); keep it out of the bundle
  // so the /api/cron/elise-sync route can require it at runtime.
  serverExternalPackages: ["snowflake-sdk"],
};

export default nextConfig;
