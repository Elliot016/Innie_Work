import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, VT323 } from "next/font/google";
import "./globals.css";

const vt323 = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Purge & Polish Industries",
  description: "Household Operations Terminal",
  // Makes "Add to Home Screen" launch fullscreen like a native app.
  appleWebApp: {
    capable: true,
    title: "Purge & Polish",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a1420",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${vt323.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
