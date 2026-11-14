import { createFileRoute } from "@tanstack/react-router";
import { MonitoringPage } from "@/components/solar/monitoring-page";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "System Monitoring | SolarVision AI" },
      {
        name: "description",
        content:
          "Check real FastAPI service health, model loading, response latency, and telemetry availability.",
      },
      { property: "og:title", content: "System Monitoring | SolarVision AI" },
      {
        property: "og:description",
        content:
          "Check real FastAPI service health, model loading, response latency, and telemetry availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MonitoringPage,
});
