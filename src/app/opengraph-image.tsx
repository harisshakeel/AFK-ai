import { ImageResponse } from "next/og";

/** The image shown when a link to AFK.ai is shared: the empty chair, the name and the promise. */
export const alt = "AFK.ai: the bot sits in your meetings so you don't have to";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#fbf9f7",
        color: "#1e1711",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg
          viewBox="0 0 64 64"
          width="80"
          height="80"
          fill="none"
          stroke="#1e1711"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 8L21 38" />
          <path d="M16 38H46" />
          <path d="M21 38L17 56" />
          <path d="M46 38L50 56" />
          <path d="M32 20H45" stroke="#da950b" />
        </svg>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>
          AFK<span style={{ color: "#6b625b" }}>.ai</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 600,
            letterSpacing: -3,
            lineHeight: 1.05,
            maxWidth: 1000,
          }}
        >
          Away from keyboard? The meeting still gets written up.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            lineHeight: 1.4,
            color: "#4a423c",
            maxWidth: 980,
          }}
        >
          The notetaker joins your call, records it, and hands you the transcript, the decisions and
          the action items, each a click from the moment it was said.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24 }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#da950b",
            display: "flex",
          }}
        />
        <div style={{ display: "flex", color: "#6b625b" }}>
          Say “AFK, decision: …” in the call and it is already in the notes.
        </div>
      </div>
    </div>,
    size,
  );
}
