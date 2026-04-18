import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production API URL — set via Vercel environment variable
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
};

export default nextConfig;
