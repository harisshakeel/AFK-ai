import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AFK.ai",
    short_name: "AFK",
    description:
      "The AI meeting notetaker: AFK joins your call, records it, and hands you the transcript, the decisions and the action items.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf9f7",
    theme_color: "#3453d3",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
