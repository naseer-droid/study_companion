import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom + pdfjs-dist use dynamic requires / ship worker code — keep them out
  // of the bundler so the legacy pdf.js build runs in the Node/serverless runtime.
  serverExternalPackages: ["jsdom", "pdfjs-dist"],
};

export default nextConfig;
