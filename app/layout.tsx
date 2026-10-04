/**
 * @file Root layout: fonts, metadata, and the mobile-first page shell.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";

/** Page metadata. */
export const metadata: Metadata = {
  title: "Bill Advocate",
  description: "Check a medical bill against your records and draft a cited dispute letter.",
};

/** Mobile viewport settings. */
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/**
 * Root layout.
 *
 * @param props.children - Page content.
 * @returns The HTML shell.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
