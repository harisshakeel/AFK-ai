import { appReady, CONNECTOR_APPS, type ConnectorView } from "./registry.ts";

/**
 * tools.md (requirement M8): what AFK may do for you, rendered from the connectors on
 * request. Never stored; read-only on the Memory page; included in the export.
 */
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function renderToolsMd(connectors: ReadonlyArray<ConnectorView>): string {
  const lines = [
    "# Tools",
    "",
    "What AFK may act through on your behalf. Every action still waits for your approval on the meeting's Tasks tab. Connect, reconnect or disconnect on the Connectors page.",
    "",
  ];
  for (const app of CONNECTOR_APPS) {
    const connector = connectors.find((candidate) => candidate.provider === app.provider);
    const ready = appReady(app, connectors);
    lines.push(`## ${app.name}`, "");
    lines.push(`- Commands: ${app.commands.map((kind) => `/${kind}`).join(", ")}`);
    lines.push(`- May: ${app.does}`);
    if (!connector || connector.status !== "connected") {
      lines.push(
        `- Status: ${connector?.status === "expired" ? "expired, reconnect" : "not connected"}`,
      );
    } else {
      lines.push(`- Account: ${connector.account}`);
      lines.push(`- Connected: ${day(connector.connectedAt)}`);
      if (connector.expiresHintAt) lines.push(`- Reconnect by: ${day(connector.expiresHintAt)}`);
      if (connector.lastUsedAt) lines.push(`- Last used: ${day(connector.lastUsedAt)}`);
      if (app.provider === "google") {
        lines.push(`- Permission: ${ready ? "granted" : "not granted, reconnect and allow it"}`);
      } else {
        const channel = connector.config.channelName;
        lines.push(`- Channel: ${typeof channel === "string" ? `#${channel}` : "none chosen yet"}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
