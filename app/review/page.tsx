/** @file Patient review workspace; the home page links here to begin bill intake. */
import BillAuditApp from "../_components/BillAuditApp";

/** Renders the existing confirmation, evidence, draft, and saved-case flow without changing its gates. */
export default function ReviewPage() {
  return <BillAuditApp />;
}
