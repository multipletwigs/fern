// What a shell printed lately, up to `limit` UTF-16 code units, the oldest dropped first. Output is
// only ever cut just after a line break, so what's kept never starts partway into an escape
// sequence or a character; the oldest piece goes whole once no line break is left to cut it at.
// Appending is amortised constant time, however small the pieces.
export const scrollback = (initialLimit: number) => {
  let limit = initialLimit;
  let pieces: Array<string> = [];
  // The oldest piece still kept: dropping one moves past it, rather than shifting every other.
  let start = 0;
  let size = 0;

  const trim = () => {
    while (size > limit) {
      const oldest = pieces[start]!;
      const over = size - limit;
      // Cutting after a line break at `at` drops `at + 1` units, which has to be at least `over`.
      const at = oldest.length > over ? oldest.indexOf("\n", over - 1) : -1;
      if (at === -1 || at === oldest.length - 1) {
        pieces[start] = "";
        start++;
        size -= oldest.length;
      } else {
        pieces[start] = oldest.slice(at + 1);
        size -= at + 1;
      }
    }
    if (start > 0 && start * 2 >= pieces.length) {
      pieces = pieces.slice(start);
      start = 0;
    }
  };

  return {
    append: (data: string) => {
      pieces.push(data);
      size += data.length;
      trim();
    },
    // From now on keeps no more than `to`.
    shrink: (to: number) => {
      limit = Math.min(limit, to);
      trim();
    },
    text: () => pieces.slice(start).join(""),
  };
};

export type Scrollback = ReturnType<typeof scrollback>;
