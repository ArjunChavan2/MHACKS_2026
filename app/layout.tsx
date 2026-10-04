/**
 * @file Root layout: fonts, metadata, and the mobile-first page shell.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";

/** Page metadata. */
export const metadata: Metadata = {
  title: "BillLess | Let’s review your bill",
  description:
    "Check a medical bill against your records and draft a cited dispute letter.",
};

/** Mobile viewport settings. */
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Root layout.
 *
 * @param props.children - Page content.
 * @returns The HTML shell.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* App Router's shared root layout loads fonts on every screen. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Nunito:wght@600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
