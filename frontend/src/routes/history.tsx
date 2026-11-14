import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "@/components/solar/history-page";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Inspection History | SolarVision AI" },
      {
        name: "description",
        content:
          "Search, review, and export completed solar inspections stored locally in your browser.",
      },
      { property: "og:title", content: "Inspection History | SolarVision AI" },
      {
        property: "og:description",
        content:
          "Search, review, and export completed solar inspections stored locally in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HistoryPage,
});
