import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native canvas and PDF.js render PDF pages to images for Grok (lib/llm/pdfPages.ts); load them
  // from node_modules at runtime instead of bundling.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // Files read from disk at runtime by computed name (sample PDFs, saved model replies, the FinchNode
  // snapshot, PDF.js fonts and worker); tracing can't see them, so include them in every API route's bundle.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./fixtures/documents/**/*",
      "./fixtures/llm-output/**/*",
      "./fixtures/finchnode/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      // PDF.js loads its worker by a runtime import the tracer can't follow.
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
