import type { PrState, PullRequestList } from "@repo/api";
import { FilterMenu } from "@repo/ui/FilterMenu";
import { FilterToggle } from "@repo/ui/FilterToggle";
import { PresetButtons } from "@repo/ui/PresetButtons";
import { PullRequestFilters } from "@repo/ui/PullRequestFilters";
import { SearchField } from "@repo/ui/SearchField";
import {
  authorChoices,
  authorValueOf,
  type DraftFilter,
  type PrFilters,
  presetOf,
  presets,
  type WalkthroughFilter,
  withPreset,
} from "./list";

const DRAFT_CHOICES: ReadonlyArray<{ value: DraftFilter; label: string }> = [
  { value: "any", label: "Any" },
  { value: "draft", label: "Drafts" },
  { value: "ready", label: "Ready" },
];

const WALKTHROUGH_CHOICES: ReadonlyArray<{
  value: WalkthroughFilter;
  label: string;
}> = [
  { value: "any", label: "Any" },
  { value: "none", label: "None" },
  { value: "unreviewed", label: "To review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "stale", label: "New commits" },
];

const STATE_CHOICES: ReadonlyArray<{ value: PrState; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

const PRESET_CHOICES = presets.map(({ preset, label }) => ({
  value: preset,
  label,
}));

// The Pull requests page's presets, filters and search, over the PRs last fetched: who wrote them
// comes from the list.
export function PullRequestFiltersBar({
  filters,
  list,
  onChange,
}: {
  filters: PrFilters;
  list: PullRequestList | undefined;
  onChange: (filters: PrFilters) => void;
}) {
  const authors = authorChoices(list, filters);
  const set = (change: Partial<PrFilters>) =>
    onChange({ ...filters, ...change });
  return (
    <PullRequestFilters
      presets={
        <PresetButtons
          label="Presets"
          presets={PRESET_CHOICES}
          value={presetOf(filters)}
          onPick={(value) => {
            const preset = presets.find((p) => p.preset === value)?.preset;
            if (preset !== undefined) onChange(withPreset(filters, preset));
          }}
        />
      }
    >
      <FilterMenu
        name="Author"
        choices={authors}
        value={authorValueOf(filters)}
        active={filters.author !== "anyone"}
        onChange={(value) => {
          const choice = authors.find((c) => c.value === value);
          if (choice !== undefined) set({ author: choice.author });
        }}
      />
      <FilterToggle
        pressed={filters.reviewRequested}
        onChange={(reviewRequested) => set({ reviewRequested })}
      >
        Review requested
      </FilterToggle>
      <FilterMenu
        name="Draft"
        choices={DRAFT_CHOICES}
        value={filters.draft}
        active={filters.draft !== "any"}
        onChange={(value) => {
          const draft = DRAFT_CHOICES.find((c) => c.value === value)?.value;
          if (draft !== undefined) set({ draft });
        }}
      />
      <FilterMenu
        name="Walkthrough"
        choices={WALKTHROUGH_CHOICES}
        value={filters.walkthrough}
        active={filters.walkthrough !== "any"}
        onChange={(value) => {
          const walkthrough = WALKTHROUGH_CHOICES.find(
            (c) => c.value === value,
          )?.value;
          if (walkthrough !== undefined) set({ walkthrough });
        }}
      />
      <FilterMenu
        name="State"
        choices={STATE_CHOICES}
        value={filters.state}
        active={filters.state !== "open"}
        onChange={(value) => {
          const state = STATE_CHOICES.find((c) => c.value === value)?.value;
          if (state !== undefined) set({ state });
        }}
      />
      <SearchField
        value={filters.search}
        placeholder="Search title, branch or #number"
        onChange={(search) => set({ search })}
      />
    </PullRequestFilters>
  );
}
