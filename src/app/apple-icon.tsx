import { ImageResponse } from "next/og";

/** The home-screen icon (180 px PNG): the chair in white on the accent, which must be opaque. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#3453d3",
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width="136"
        height="136"
        fill="none"
        stroke="#ffffff"
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
    </div>,
    size,
  );
}
