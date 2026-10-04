import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native canvas and PDF.js render PDF pages to images for Grok (lib/llm/pdfPages.ts); load them
  // from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
