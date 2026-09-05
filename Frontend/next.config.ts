import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",   // generates the `out/` folder for Azure Static Web Apps
  trailingSlash: true, // recommended for static hosting
  images: {
    unoptimized: true, // required for static export (no Next.js image server)
  },
};

export default nextConfig;