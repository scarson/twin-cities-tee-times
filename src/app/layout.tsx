import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twin Cities Tee Times",
  description:
    "Check tee times at public golf courses in the Twin Cities metro",
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
