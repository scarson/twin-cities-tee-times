// ABOUTME: Root layout with global styles, metadata, and navigation.
// ABOUTME: Wraps all pages with Nav component and base styling.
import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { AuthProvider } from "@/components/auth-provider";
import { LocationProvider } from "@/context/location-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twin Cities Tee Times",
  description:
    "Find available tee times across Twin Cities metro golf courses",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#faf7f2] text-gray-900">
        <AuthProvider>
          <LocationProvider>
            <Nav />
            {children}
          </LocationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
