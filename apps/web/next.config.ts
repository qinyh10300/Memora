import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";
    return [{ source: "/api/:path*", destination: `${apiBaseUrl}/:path*` }];
  },
};

export default nextConfig;
