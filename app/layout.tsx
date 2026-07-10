import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Lamp",
  description: "A learning companion that learns alongside you",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
