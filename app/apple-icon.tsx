import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: gold "iD" monogram on the Lumon-dark background.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0D0D0D",
          color: "#F0C94A",
          fontFamily: "monospace",
          fontWeight: 700,
        }}
      >
        <div style={{ fontSize: 96, lineHeight: 1 }}>iD</div>
        <div style={{ fontSize: 18, letterSpacing: 4, color: "#7EC8F5", marginTop: 8 }}>
          LUMON
        </div>
      </div>
    ),
    { ...size }
  );
}
