import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hosted Go Scratchpad",
  description: "A hosted personal Go scratchpad (MVP scaffold).",
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
