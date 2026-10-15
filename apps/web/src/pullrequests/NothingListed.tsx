import { ListEmpty } from "@repo/ui/ListEmpty";
import type { EmptyList, PrFilters } from "./list";

// What the Pull requests page says when no PR shows, with Clear filters when clearing them would
// show some.
export function NothingListed({
  empty,
  onClear,
}: {
  empty: EmptyList;
  onClear: (filters: PrFilters) => void;
}) {
  const { clear } = empty;
  return clear === undefined ? (
    <ListEmpty text={empty.text} />
  ) : (
    <ListEmpty
      text={empty.text}
      action="Clear filters"
      onAction={() => onClear(clear)}
    />
  );
}
