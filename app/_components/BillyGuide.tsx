/**
 * @file BillLess's illustrated administrative guide and named progress steps (SPEC.md §2, §6 MVP 1).
 * Uses fixed interface copy only: Billy never invents a finding, a health fact, or a savings claim.
 */
import Image from "next/image";

/** Browser workflow stages shared by the progress indicator and mascot. */
export type ReviewStep = "start" | "confirm" | "audit" | "letter" | "request";

/** Fixed administrative labels; these describe the workflow, not medical evidence. */
const STEPS = ["Upload", "Confirm", "Review", "Prepare letter"] as const;

/** Maps alternate balance-statement requests onto the confirmation stage. */
const STEP_INDEX: Record<ReviewStep, number> = {
  start: 0,
  confirm: 1,
  audit: 2,
  letter: 3,
  request: 1,
};

/** Fixed prompts for each stage; no patient or clinical facts are inserted here. */
const GUIDE_COPY: Record<
  ReviewStep,
  {
    /** Visible task heading. */ title: string;
    /** Billy's team-voice administrative prompt. */ message: string;
  }
> = {
  start: {
    title: "Let’s review your bill.",
    message:
      "Let’s take this one step at a time. Add your bill below, and we’ll help you work out what to ask next.",
  },
  confirm: {
    title: "Let’s get the details right.",
    message:
      "Let’s check the extracted details against your documents before reviewing the charges.",
  },
  audit: {
    title: "Here’s what we can review.",
    message:
      "Let’s look at the items worth asking about. You can open the details and evidence whenever you need them.",
  },
  letter: {
    title: "Your next step, in writing.",
    message:
      "Let’s review your letter together. You decide whether to download it and send it yourself.",
  },
  request: {
    title: "Let’s ask for the full picture.",
    message:
      "This statement has a balance but no individual charges. Let’s prepare a request for an itemized bill.",
  },
};

/**
 * Shows the four named steps without offering navigation that could bypass confirmation.
 * @param props.step - Current workflow stage.
 * @returns An ordered, accessible progress indicator; completed steps carry a text checkmark.
 * Pure: no API calls or state mutation.
 */
export function ReviewProgress({
  step,
}: {
  /** Current browser stage. */ step: ReviewStep;
}) {
  /** Current zero-based position in the four-step flow. */
  const current = STEP_INDEX[step];
  return (
    <nav className="billless-progress" aria-label="Review progress">
      <ol>
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={
              index === current
                ? "is-current"
                : index < current
                  ? "is-complete"
                  : ""
            }
            aria-current={index === current ? "step" : undefined}
          >
            <span className="billless-step-number" aria-hidden="true">
              {index < current ? "✓" : index + 1}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Billy provides the current task heading and a short fixed administrative prompt.
 * @param props.step - Current workflow stage, used only for interface wording.
 * @param props.busy - Selects an upload/review processing reaction.
 * @param props.error - Suppresses playful motion while an error needs attention.
 * @param props.noFindings - Changes the review prompt without claiming the bill is error-free.
 * @returns A responsive illustrated heading; CSS respects reduced-motion preferences.
 * Pure: no data interpretation, commitments, or side effects.
 */
export default function BillyGuide({
  step,
  busy,
  error,
  noFindings,
}: {
  /** Workflow stage. */ step: ReviewStep;
  /** An administrative request is running. */ busy: boolean;
  /** The interface is showing an error. */ error: boolean;
  /** Server audit returned an empty list of findings. */ noFindings: boolean;
}) {
  /** Fixed copy for the current stage. */
  const copy = GUIDE_COPY[step];
  /** Processing text describes a task, never a promised result. */
  const message = error
    ? "Let’s fix this before we move on. Your documents and evidence are still the guide."
    : busy
      ? "We’re working on this step. Let’s give it a moment."
      : noFindings
        ? "The checks we ran found no issues. Let’s look at your options without assuming every charge is correct."
        : copy.message;
  return (
    <section
      className={`billless-intro ${busy && !error ? "is-working" : ""}`}
      aria-label="Billy’s guide"
    >
      <div>
        <p className="paper-eyebrow">A LITTLE HELP FROM BILLY</p>
        <h1>{noFindings ? "Your review is ready." : copy.title}</h1>
        <p className="billless-guide-message" role="status">
          {message}
        </p>
      </div>
      <div className="billless-billy-scene" aria-hidden="true">
        <span className="billless-orbit billless-orbit-one" />
        <span className="billless-orbit billless-orbit-two" />
        <Image
          src="/brand/billy.png"
          alt=""
          width={170}
          height={204}
          priority={step === "start"}
          className="billless-billy"
        />
        <span className="billless-billy-shadow" />
      </div>
    </section>
  );
}
