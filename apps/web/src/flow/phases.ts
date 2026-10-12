import type { Phase } from "@repo/api";

export const PHASE_TITLES: Record<Phase, string> = {
  grill: "Grill",
  spec: "Spec",
  implement: "Implement",
  retro: "Retro",
};

// What a Checkpoint at the end of each Phase asks the developer.
export const CHECKPOINT_QUESTIONS: Record<Phase, string> = {
  grill: "Do you and Claude share an understanding of the work?",
  spec: "Is the Brief and its tickets right?",
  implement: "Is the work ready to look back on?",
  retro: "Is the Retro done?",
};
