import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/components/solar/overview";

// The home route ships no og:image, so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview | SolarVision AI" },
      {
        name: "description",
        content:
          "SolarVision AI inspection overview, local analysis history, and inference service health.",
      },
      { property: "og:title", content: "Overview | SolarVision AI" },
      {
        property: "og:description",
        content:
          "SolarVision AI inspection overview, local analysis history, and inference service health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});
