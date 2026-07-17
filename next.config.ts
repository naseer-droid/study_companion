import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom uses dynamic requires — keep it out of the bundler.
  serverExternalPackages: ["jsdom"],
};

export default nextConfig;
