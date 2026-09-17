import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stuck Stonks",
  description: "Recent and dormant-with-pending-fees tokens on stonk.fun",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
