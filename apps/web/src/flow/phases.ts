import type { Boundary, Phase } from "@repo/api";

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

// What each boundary Autonomy can earn is called, and what Fern does there once it covers it.
export const BOUNDARY_TITLES: Record<Boundary, string> = {
  spec: "Spec",
  implement: "Implement",
  land: "Land",
};
export const BOUNDARY_ACTIONS: Record<Boundary, string> = {
  spec: "approve the end of Spec",
  implement: "approve the end of Implement",
  land: "land Stacks on main",
};
