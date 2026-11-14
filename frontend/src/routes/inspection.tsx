import { createFileRoute } from "@tanstack/react-router";
import { InspectionPage } from "@/components/solar/inspection";

export const Route = createFileRoute("/inspection")({
  head: () => ({
    meta: [
      { title: "AI Inspection | SolarVision AI" },
      {
        name: "description",
        content:
          "Independent solar panel detection, defect detection, and thermal classification using your FastAPI service.",
      },
      { property: "og:title", content: "AI Inspection | SolarVision AI" },
      {
        property: "og:description",
        content:
          "Independent solar panel detection, defect detection, and thermal classification using your FastAPI service.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InspectionPage,
});
