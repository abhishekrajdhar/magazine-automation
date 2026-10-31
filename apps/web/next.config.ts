import type { NextConfig } from "next";

const apiUrl = process.env.PRESSFLOW_API_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Uploads (reference PDFs up to 200 MB, recordings up to 2 GB — the API's
    // MAX_*_UPLOAD_MB limits) pass through the /api/v1 rewrite. With proxy.ts
    // present Next.js buffers request bodies and truncates them at 10 MB by
    // default, so raise the cap to the API's largest limit.
    proxyClientMaxBodySize: "2100mb",
    // Large uploads to the API can take minutes.
    proxyTimeout: 30 * 60 * 1000,
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
