import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Processed historical data is read from disk at runtime by server routes/pages.
  outputFileTracingIncludes: {
    "/**": ["./data/processed/*.json", "./data/demo/seed-store.json"],
  },
  poweredByHeader: false,
};

export default nextConfig;
