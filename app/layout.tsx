/**
 * @file Root layout: fonts, metadata, and the mobile-first page shell.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";

/** Page metadata. */
export const metadata: Metadata = {
  title: "Billkind | Your medical bill, made clearer",
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
