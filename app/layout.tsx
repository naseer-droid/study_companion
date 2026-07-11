import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaSetup from "@/components/PwaSetup";

export const metadata: Metadata = {
  title: "Study Lamp",
  description: "A learning companion that learns alongside you",
  // iOS reads these instead of the manifest for installed-app behavior.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Study Lamp",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#141A26",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // draw behind the iPhone notch in standalone mode
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaSetup />
      </body>
    </html>
  );
}
