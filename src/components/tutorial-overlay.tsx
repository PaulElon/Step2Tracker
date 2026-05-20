import { primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import type { TutorialState, TutorialStep, TutorialStepId } from "../lib/tutorial-state";

const TUTORIAL_COPY: Record<
  TutorialStepId,
  {
    title: string;
    description: string;
    hint: string;
  }
> = {
  today: {
    title: "Start on Today",
    description: "This is the launch point for your daily study plan, upcoming tasks, and quick progress checks.",
    hint: "Use this surface to orient your day before you dive into detailed planning.",
  },
  planner: {
    title: "Plan upcoming study blocks",
    description: "The planner is where you schedule work, adjust order, and shape the next stretch of study time.",
    hint: "Move here when you need to build or rebalance your calendar.",
  },
  weakTopics: {
    title: "Track weak topics",
    description: "Weak Topics collects the concepts that need more attention so you can prioritize them deliberately.",
    hint: "Review this list after practice sessions or whenever you notice repeat misses.",
  },
  practiceTests: {
    title: "Review practice test history",
    description: "Practice Tests keeps your scores, reflections, and topic takeaways in one place.",
    hint: "Use it to compare forms and spot where your review plan is paying off.",
  },
  errorLog: {
    title: "Capture recurring mistakes",
    description: "The Error Log is for mistakes worth preserving so they stop repeating across future sessions.",
    hint: "Add misses here when you want a tighter feedback loop than broad notes provide.",
  },
  timefolio: {
    title: "Open the TimeFolio tracker",
    description: "Session Log gives you the time-tracking side of TimeFolio so you can review where work actually went.",
    hint: "This is the best place to compare planned effort against logged study time.",
  },
  settings: {
    title: "Tune the app in Settings",
    description: "Settings holds local preferences, reminders, recovery controls, and this tutorial entry point.",
    hint: "Come back here anytime you want to restart the walkthrough or reset its saved progress.",
  },
  notebook: {
    title: "Keep long-form notes in Notebook",
    description: "Notebook is the workspace for documents, reference material, and longer study notes.",
    hint: "Use it when a topic needs more room than a task note or error log entry.",
  },
};

export function TutorialOverlay({
  tutorialState,
  steps,
  onBack,
  onNext,
  onSkip,
  onFinish,
}: {
  tutorialState: TutorialState;
  steps: TutorialStep[];
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  if (!tutorialState.active || !tutorialState.currentStepId) {
    return null;
  }

  const stepIndex = steps.findIndex((step) => step.id === tutorialState.currentStepId);
  if (stepIndex < 0) {
    return null;
  }

  const step = steps[stepIndex];
  const copy = TUTORIAL_COPY[step.id];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;
  const progress = steps.length > 1 ? (stepIndex / (steps.length - 1)) * 100 : 100;

  return (
    <div className="pointer-events-none fixed inset-0 z-[10010]">
      <div className="absolute inset-0 bg-slate-950/58 backdrop-blur-[1.5px]" />
      <div className="absolute inset-x-4 bottom-4 flex justify-center sm:justify-end">
        <section
          aria-labelledby="tutorial-overlay-title"
          className="tutorial-overlay-card pointer-events-auto w-full max-w-[430px] overflow-hidden rounded-[28px] border border-white/10 p-5 text-white shadow-[0_30px_90px_rgba(2,8,23,0.58)]"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.65rem] uppercase tracking-[0.24em] text-cyan-200/80">Tutorial</p>
              <h3 id="tutorial-overlay-title" className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
                {copy.title}
              </h3>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
              Step {stepIndex + 1} of {steps.length}
            </div>
          </div>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/8">
            <div className="tutorial-overlay-progress h-full rounded-full" style={{ width: `${progress}%` }} />
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-200">{copy.description}</p>
          <p className="mt-3 rounded-[18px] border border-cyan-300/15 bg-cyan-300/[0.08] px-4 py-3 text-xs leading-5 text-cyan-50/90">
            {copy.hint}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={onBack}
              disabled={isFirstStep}
            >
              Back
            </button>
            <button type="button" className={secondaryButtonClassName} onClick={onSkip}>
              Skip
            </button>
            <button
              type="button"
              className={`ml-auto ${primaryButtonClassName}`}
              onClick={isLastStep ? onFinish : onNext}
            >
              {isLastStep ? "Finish" : "Next"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
