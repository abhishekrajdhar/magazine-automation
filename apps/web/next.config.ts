import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Uploads (reference PDFs up to 200 MB, recordings up to 2 GB — the API's
    // MAX_*_UPLOAD_MB limits) pass through the /api/v1 proxy in src/proxy.ts. With proxy.ts
    // present Next.js buffers request bodies and truncates them at 10 MB by
    // default, so raise the cap to the API's largest limit.
    proxyClientMaxBodySize: "2100mb",
    // Large uploads to the API can take minutes.
    proxyTimeout: 30 * 60 * 1000,
  },
  // The browser only ever talks to /api/v1 on this origin; src/proxy.ts forwards it to PRESSFLOW_API_URL, read
  // at request time, so the API URL and any credentials stay server-side.
  // Baseline response headers. HSTS only takes effect over HTTPS, so it is harmless on localhost.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
};

export default nextConfig;
