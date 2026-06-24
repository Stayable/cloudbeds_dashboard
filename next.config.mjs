/** @type {import('next').NextConfig} */
import { withBotId } from "botid/next/config";

const nextConfig = {
  reactStrictMode: true,
  // Cloudbeds credentials are read server-side only — never exposed to the client.
};

export default withBotId(nextConfig);
