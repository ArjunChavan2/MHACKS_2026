/** @file Sample privacy information for the prototype; retention and deletion details remain unfinalized. */
import InfoPage from "../_components/InfoPage";

/** Displays sample privacy sections without promising unimplemented data handling controls. */
export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy">
      <section>
        <h2>What you bring to BillLess</h2>
        <p>
          A review starts with an itemized bill and an optional explanation of
          benefits. You check the extracted details before the bill is reviewed.
          For this hackathon demo, use synthetic documents only.
        </p>
      </section>
      <section>
        <h2>How information supports a review</h2>
        <p>
          The workflow uses document details to check charges, show the sources
          behind findings, and prepare a draft you can review. You decide
          whether to download and send that draft.
        </p>
      </section>
      <section>
        <h2>Storage and deletion</h2>
        <p>
          Sample policy section: before a public launch, this page should name
          the storage and AI providers, explain who can access uploaded
          documents, state the retention period, and provide a working deletion
          process. These details are not finalized in this prototype.
        </p>
      </section>
      <section>
        <h2>Privacy questions</h2>
        <p>
          Sample contact:{" "}
          <span className="billless-example-email">privacy@example.com</span>.
          This example address is not monitored.
        </p>
      </section>
    </InfoPage>
  );
}
