import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meanwhile — a world of stories",
  description:
    "Ask about a moment in history. Watch its story unfold on a living globe.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
