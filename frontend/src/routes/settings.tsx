import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/solar/settings-page";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings | SolarVision AI" },
      {
        name: "description",
        content:
          "Configure your FastAPI connection, workspace appearance, analysis defaults, and local history.",
      },
      { property: "og:title", content: "Settings | SolarVision AI" },
      {
        property: "og:description",
        content:
          "Configure your FastAPI connection, workspace appearance, analysis defaults, and local history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});
