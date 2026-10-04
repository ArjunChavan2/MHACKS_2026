/**
 * @file Renders a finished draft to a PDF (SPEC.md §4.5).
 *
 * Server-only. Takes text already filled by `placeholders.ts`; adds nothing of its own except the
 * date line and layout.
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Draft } from "@/lib/types";

/** Letter layout styles. */
const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.45 },
  date: { marginBottom: 18, color: "#444" },
  subject: { fontFamily: "Helvetica-Bold", marginBottom: 14 },
  paragraph: { marginBottom: 10 },
  disclaimer: { marginTop: 16, fontSize: 8.5, color: "#666" },
});

/**
 * React-PDF document for a draft.
 *
 * @param props.draft - The filled draft; the last paragraph is treated as the disclaimer.
 * @param props.date - Date line text.
 * @returns The PDF document element.
 */
function LetterDocument({ draft, date }: { draft: Draft; date: string }) {
  const body = draft.paragraphs.slice(0, -1);
  const disclaimer = draft.paragraphs.at(-1);
  return (
    <Document title={draft.subject}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.date}>{date}</Text>
        <Text style={styles.subject}>Re: {draft.subject}</Text>
        <View>
          {body.map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p.text}
            </Text>
          ))}
        </View>
        {disclaimer && <Text style={styles.disclaimer}>{disclaimer.text}</Text>}
      </Page>
    </Document>
  );
}

/**
 * Renders a draft to PDF bytes.
 *
 * Side effects: none beyond CPU work.
 *
 * @param draft - Filled draft.
 * @param date - Date line, e.g. "October 3, 2026".
 * @returns PDF file bytes.
 */
export async function renderDraftPdf(draft: Draft, date: string): Promise<Buffer> {
  return renderToBuffer(<LetterDocument draft={draft} date={date} />);
}
