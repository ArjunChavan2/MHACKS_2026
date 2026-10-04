/** @file Shared shell for clearly labeled sample footer pages; makes no production policy claims. */
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Presents placeholder information with a consistent home link and readable typography.
 * @param props.title - Page heading.
 * @param props.children - Sample informational content.
 * @param props.action - Optional page-specific action opposite the home link.
 * @returns A server-rendered informational page with an explicit demo label.
 */
export default function InfoPage({
  title,
  children,
  action,
}: {
  /** Visible page heading. */ title: string;
  /** Page-specific sample sections. */ children: ReactNode;
  /** Optional trailing navigation action. */ action?: ReactNode;
}) {
  return (
    <div className="billless-info-page">
      <header className="billless-site-header">
        <Link href="/" className="paper-wordmark" aria-label="BillLess home">
          Bill<span>Less</span>
          <span className="billless-brand-dot">.</span>
        </Link>
      </header>
      <main>
        <p className="billless-info-label">Sample content · Hackathon demo</p>
        <h1>{title}</h1>
        <p className="billless-info-intro">
          This is placeholder content for the prototype. It is not a published
          policy or an active support service.
        </p>
        {children}
        <div className="billless-info-actions">
          <Link href="/" className="paper-text-button">
            ← Back to home
          </Link>
          {action}
        </div>
      </main>
      <nav className="billless-footer-links" aria-label="Footer navigation">
        <Link href="/privacy">Privacy</Link>
        <Link href="/help">Help / Contact</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </div>
  );
}
