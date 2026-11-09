import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DAN Restaurant POS",
  description: "Restaurant point-of-sale and operations",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
