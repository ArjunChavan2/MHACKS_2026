/** @file Sample help page with workflow guidance and a reserved, non-operational example email. */
import InfoPage from "../_components/InfoPage";
import Link from "next/link";

/** Renders basic product guidance and clearly identifies the contact address as a placeholder. */
export default function HelpPage() {
  return (
    <InfoPage
      title="Help / Contact"
      action={
        <Link href="/review" className="paper-text-button">
          Start a bill review →
        </Link>
      }
    >
      <section>
        <h2>What do I need to start?</h2>
        <p>
          Bring an itemized bill as a PDF or photo. If you have an explanation
          of benefits (EOB) from your insurer, add it too. You can also explore
          the synthetic examples on the upload screen.
        </p>
      </section>
      <section>
        <h2>I only have a balance statement.</h2>
        <p>
          The review flow can help prepare a request for an itemized bill.
          Individual charges are needed before a bill audit can run.
        </p>
      </section>
      <section>
        <h2>Does BillLess send my letter?</h2>
        <p>
          The draft is yours to review and download. You decide whether to send
          it. A flagged item is a question to investigate, not a confirmed
          reduction in your bill.
        </p>
      </section>
      <section>
        <h2>Get in touch</h2>
        <p>
          Sample support address:{" "}
          <span className="billless-example-email">support@example.com</span>.
          This is a placeholder, not an active inbox. A real contact channel
          will replace it before launch.
        </p>
        <p>
          When reporting a technical problem, describe the step and error
          message. Keep medical documents and personal details out of general
          support messages.
        </p>
      </section>
    </InfoPage>
  );
}
