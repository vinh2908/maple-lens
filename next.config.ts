import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.MAPLE_PREVIEW_BUILD === "1" ? ".next-preview" : ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default config;
