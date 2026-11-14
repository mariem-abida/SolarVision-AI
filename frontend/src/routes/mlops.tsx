import { createFileRoute } from "@tanstack/react-router";
import { MlopsPage } from "@/components/solar/mlops-page";

export const Route = createFileRoute("/mlops")({
  head: () => ({
    meta: [
      { title: "MLOps Center | SolarVision AI" },
      {
        name: "description",
        content:
          "Review experiment tracking, model lifecycle, and deployment integration availability.",
      },
      { property: "og:title", content: "MLOps Center | SolarVision AI" },
      {
        property: "og:description",
        content:
          "Review experiment tracking, model lifecycle, and deployment integration availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MlopsPage,
});
