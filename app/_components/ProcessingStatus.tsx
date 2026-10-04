"use client";
/** @file Honest feedback for synchronous document processing (SPEC.md §4.2.8); no invented progress. */
import { useEffect, useState } from "react";

/**
 * Shows the filename, elapsed wait and confirmation reminder during one upload request.
 * @param props.filename - Patient-selected file name; mount once per active request.
 * @param props.inline - Uses the upload action’s existing layout rather than a separate card.
 * @returns Accessible status and a visual timer that does not announce every tick.
 * Side effects: runs a timer only while mounted; never predicts server processing stages.
 */
export default function ProcessingStatus({
  filename,
  inline = false,
}: {
  filename: string;
  inline?: boolean;
}) {
  /** Seconds since this processing panel mounted, not an estimated completion time. */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <aside
      className={
        inline
          ? "billless-inline-processing"
          : "paper-flow billless-processing-panel"
      }
    >
      <p role="status">
        Reading and checking <strong>{filename}</strong>. You’ll confirm the
        details next.
      </p>
      <p className="paper-copy" aria-live="off">
        Elapsed: {elapsed}s. Longer documents can take more time.
      </p>
    </aside>
  );
}
