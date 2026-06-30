import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: a yellow person silhouette on the Lumon-dark background.
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
        }}
      >
        {/* head */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#F0C94A",
          }}
        />
        {/* shoulders / body */}
        <div
          style={{
            width: 104,
            height: 64,
            marginTop: 10,
            borderRadius: "52px 52px 14px 14px",
            background: "#F0C94A",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
