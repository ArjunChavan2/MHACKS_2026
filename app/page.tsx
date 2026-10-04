/**
 * @file BillLess landing page. Keeps existing root-level saved-case links working.
 */
import BillAuditApp from "./_components/BillAuditApp";
import Image from "next/image";
import Link from "next/link";
import sampleBill from "@/fixtures/llm-output/sample-bill.json";

/** Verbatim lines from the synthetic sample bill; illustrates repeated charges, not savings. */
const EXAMPLE_LINES = [sampleBill.lines[2], sampleBill.lines[4]];

/**
 * Introduces the review workflow without making savings or medical claims.
 * @param props.searchParams - URL parameters; existing ?case= links resume the case.
 * @returns The landing page, or the original workspace for a saved-case link.
 */
export default async function Home({
  searchParams,
}: {
  /** Incoming query parameters resolved by Next.js. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { case: caseId } = await searchParams;
  if (typeof caseId === "string" && caseId) return <BillAuditApp />;
  return (
    <div className="billless-home">
      <header className="billless-home-nav billless-site-header">
        <Link className="paper-wordmark" href="/" aria-label="BillLess home">
          Bill<span>Less</span>
          <span className="billless-brand-dot">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works" className="billless-how-link">
            How it works
          </a>
          <Link className="paper-secondary" href="/review">
            Review my bill <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>
      <main>
        <section className="billless-home-hero" aria-labelledby="home-heading">
          <div className="billless-home-copy">
            <p className="billless-home-eyebrow">
              <span aria-hidden="true" /> MEDICAL BILL REVIEW
            </p>
            <h1 id="home-heading">
              Know what to question <span>on your medical bill.</span>
            </h1>
            <p className="billless-home-description">
              Check for duplicate charges and differences from your insurance
              explanation. See the source behind each finding, then prepare a
              letter to the billing office.
            </p>
            <Link className="paper-primary billless-home-cta" href="/review">
              Review my bill <span aria-hidden="true">→</span>
            </Link>
            <p className="billless-home-small">
              Start with an itemized bill. Add your insurance explanation if you
              have it.
            </p>
            <div className="billless-home-promise">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
                <path d="m8 12 3 3 5-6" />
              </svg>
              <span>Nothing is sent without your approval.</span>
            </div>
          </div>
          <div
            className="billless-home-art"
            role="group"
            aria-label="Billy the goat beside a synthetic bill example"
          >
            <div className="billless-home-sky" aria-hidden="true" />
            <div className="billless-home-receipt">
              <div className="billless-receipt-top">
                <span>SYNTHETIC BILL · DEMO ONLY</span>
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="M7 3h7l4 4v14H7z" />
                  <path d="M14 3v5h4M10 12h5M10 16h5" />
                </svg>
              </div>
              <div className="billless-receipt-heading">
                The same charge, twice?
              </div>
              <div className="billless-receipt-rows">
                {EXAMPLE_LINES.map((line) => (
                  <div
                    className="billless-receipt-row"
                    key={line.lineNumber.raw}
                  >
                    <div>
                      <strong>Bill line {line.lineNumber.raw}</strong>
                      <span>
                        Code {line.code.raw} · {line.serviceDate.raw}
                      </span>
                    </div>
                    <strong className="billless-receipt-amount">
                      {line.charge.raw}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="billless-receipt-finding">
                <span className="billless-receipt-check" aria-hidden="true">
                  ?
                </span>
                <div>
                  <strong>Possible duplicate</strong>
                  <p>Ask whether both charges apply.</p>
                </div>
              </div>
              <div className="billless-receipt-footer">
                Source: sample bill, page 1, lines 3 &amp; 5
              </div>
            </div>
            <div className="billless-home-billy">
              <Image
                src="/brand/billy.png"
                alt="Billy, our friendly goat guide, waving"
                width={280}
                height={340}
                priority
              />
            </div>
            <div className="billless-home-speech">We goat this.</div>
          </div>
        </section>
        <section
          id="how-it-works"
          className="billless-home-how"
          aria-labelledby="how-heading"
        >
          <div className="billless-home-section-heading">
            <h2 id="how-heading">How it works</h2>
            <p>You check the document details before we review the charges.</p>
          </div>
          <div className="billless-home-steps">
            <article>
              <span className="billless-home-step">01</span>
              <h3>Upload and confirm.</h3>
              <p>
                Upload your itemized bill and an optional explanation of
                benefits (EOB). Check the details we read before moving on.
              </p>
            </article>
            <article>
              <span className="billless-home-step">02</span>
              <h3>Review the findings.</h3>
              <p>
                Review flagged items with clear explanations and links to their
                sources. An item under review isn’t a confirmed saving.
              </p>
            </article>
            <article>
              <span className="billless-home-step">03</span>
              <h3>Prepare your letter.</h3>
              <p>
                Prepare a dispute draft when there are findings to discuss.
                Review it, download it, and decide whether to send it.
              </p>
            </article>
          </div>
        </section>
      </main>
      <footer className="billless-home-footer">
        <span>© 2026 BillLess</span>
        <nav aria-label="Footer navigation" className="billless-footer-links">
          <a href="#how-it-works">How it works</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/help">Help / Contact</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
