import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["pdf-parse", "mammoth", "node-ical", "rrule-temporal", "temporal-polyfill"],
};

export default nextConfig;
