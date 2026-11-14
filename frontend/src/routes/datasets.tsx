import { createFileRoute } from "@tanstack/react-router";
import { DatasetsPage } from "@/components/solar/datasets-page";

export const Route = createFileRoute("/datasets")({
  head: () => ({
    meta: [
      { title: "Dataset Explorer | SolarVision AI" },
      {
        name: "description",
        content:
          "Explore SolarVision project datasets, thermal classification splits, and preparation workflow.",
      },
      { property: "og:title", content: "Dataset Explorer | SolarVision AI" },
      {
        property: "og:description",
        content:
          "Explore SolarVision project datasets, thermal classification splits, and preparation workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DatasetsPage,
});
