import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talk to a Document or YouTube Video",
  description: "Live voice conversations powered by OpenAI Realtime API",
  viewport: {
    width: "device-width",
    initialScale: 1,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
