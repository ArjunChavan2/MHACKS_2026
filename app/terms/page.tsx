/** @file Sample terms page; explicitly a prototype outline rather than a binding production agreement. */
import InfoPage from "../_components/InfoPage";

/** Displays the demo scope and a placeholder outline for future published terms. */
export default function TermsPage() {
  return (
    <InfoPage title="Terms">
      <section>
        <h2>About this prototype</h2>
        <p>
          BillLess is a hackathon project for reviewing itemized bill costs and
          preparing evidence-linked questions and drafts. These sample terms
          describe the demo; they are not a finalized service agreement.
        </p>
      </section>
      <section>
        <h2>Your review and decisions</h2>
        <p>
          Check extracted information against your original documents. Review
          findings and their sources before acting. You control whether a draft
          is sent or any proposed action is approved.
        </p>
      </section>
      <section>
        <h2>What a review means</h2>
        <p>
          A review can flag supported concerns or requests for documentation. It
          does not guarantee that every error will be found, that a flagged
          charge is incorrect, or that your balance will be reduced. BillLess
          does not provide medical advice.
        </p>
      </section>
      <section>
        <h2>Before public launch</h2>
        <p>
          Sample agreement section: final terms should identify the service
          operator, eligibility requirements, acceptable use, account
          responsibilities, dispute procedures, and contact information. Those
          terms still need to be prepared and reviewed.
        </p>
      </section>
    </InfoPage>
  );
}
