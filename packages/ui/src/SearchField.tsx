import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";

// A free-text search over a list, narrowing it as the developer types. Escape, or the cross,
// empties it.
export function SearchField({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-7 min-w-56 flex-1 items-center gap-2 rounded-lg border border-hairline px-2.5 text-[12px] text-ink focus-within:border-ice/30">
      <MagnifyingGlassIcon className="size-3.5 shrink-0 text-faint" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            onChange("");
          }
        }}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => onChange("")}
          className="shrink-0 text-faint hover:text-ink"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </label>
  );
}
