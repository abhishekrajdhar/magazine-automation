import type { NextConfig } from "next";

const apiUrl = process.env.PRESSFLOW_API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // File watching inside iCloud-managed folders can miss edits; a persistent
    // dev cache then serves stale server modules after a restart.
    turbopackFileSystemCacheForDev: false,
  },
  // The browser only ever talks to /api/v1 on this origin; the API URL and any
  // credentials stay server-side.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiUrl}/api/v1/:path*` }];
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
};

export default nextConfig;
