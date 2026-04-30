import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1mb; createCampaign passes the full leads[] array to
      // the server, which a 200+ row scrape (or a manual 2k-row upload)
      // overshoots once summaries are included. 10mb is generous for the
      // 5-person internal team and keeps both ingestion paths working.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
