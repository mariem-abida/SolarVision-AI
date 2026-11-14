import { createFileRoute } from "@tanstack/react-router";
import { ModelsPage } from "@/components/solar/models-page";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "Model Performance | SolarVision AI" },
      {
        name: "description",
        content: "Fixed classification and detection evaluation results for SolarVision models.",
      },
      { property: "og:title", content: "Model Performance | SolarVision AI" },
      {
        property: "og:description",
        content: "Fixed classification and detection evaluation results for SolarVision models.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ModelsPage,
});
