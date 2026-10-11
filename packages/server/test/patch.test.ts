import { assert, describe, it } from "@effect/vitest";
import { parseNumstat, parsePatch } from "../src/snapshot/patch";
import { settle, unclaimedHunks } from "../src/walkthrough/coverage";

const patch = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
 export const c = 4;
@@ -10,2 +10,3 @@ function f() {
   return 1;
+  // done
 }
diff --git a/new file.md b/new file.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new file.md
@@ -0,0 +1,2 @@
+# Title
+--- not a header
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
\\ No newline at end of file
diff --git a/img.png b/img.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/img.png differ
diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29
`;

describe("parsePatch", () => {
  it("splits files into hunks with their counts", () => {
    const hunks = parsePatch(patch);
    assert.deepStrictEqual(
      hunks.map(({ path, header, added, removed }) => ({
        path,
        header,
        added,
        removed,
      })),
      [
        { path: "src/a.ts", header: "@@ -1,3 +1,3 @@", added: 1, removed: 1 },
        {
          path: "src/a.ts",
          header: "@@ -10,2 +10,3 @@ function f() {",
          added: 1,
          removed: 0,
        },
        {
          path: "new file.md",
          header: "@@ -0,0 +1,2 @@",
          added: 2,
          removed: 0,
        },
        { path: "gone.txt", header: "@@ -1 +0,0 @@", added: 0, removed: 1 },
        {
          path: "img.png",
          header: "Binary file changed",
          added: 0,
          removed: 0,
        },
        { path: "empty.txt", header: "New empty file", added: 0, removed: 0 },
      ],
    );
  });

  it("keeps a hunk's lines, a removed line that looks like a header included", () => {
    const [, , added, deleted] = parsePatch(patch);
    assert.deepStrictEqual(added?.lines, ["+# Title", "+--- not a header"]);
    assert.deepStrictEqual(deleted?.lines, [
      "-bye",
      "\\ No newline at end of file",
    ]);
  });
});

describe("parseNumstat", () => {
  it("reads counts, binary files, and paths with tabs", () => {
    assert.deepStrictEqual(
      parseNumstat(
        ["9\t0\tdocs/demo.md", "-\t-\timg.png", "1\t2\ta\tb.txt", ""].join(
          "\0",
        ),
      ),
      [
        { path: "docs/demo.md", added: 9, removed: 0, binary: false },
        { path: "img.png", added: 0, removed: 0, binary: true },
        { path: "a\tb.txt", added: 1, removed: 2, binary: false },
      ],
    );
  });
});

describe("coverage", () => {
  const draft = {
    sections: [
      { title: "One", explanation: "x", hunks: ["h1", "h2", "h9"] },
      { title: "Two", explanation: "y", hunks: ["h2"] },
      { title: " ", explanation: "z", hunks: ["h3"], dropped: " " },
    ],
    notFromSession: ["h4", "h8"],
  };

  it("finds hunks neither claimed nor marked as someone else's", () => {
    assert.deepStrictEqual(
      unclaimedHunks(draft, ["h1", "h2", "h3", "h4", "h5"]),
      ["h5"],
    );
  });

  it("drops made-up ids, double claims, and empty Sections", () => {
    const { sections, notFromSession } = settle(draft, [
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
    assert.deepStrictEqual(
      sections.map((s) => ({
        title: s.title,
        hunks: s.hunks,
        dropped: s.dropped,
      })),
      [
        { title: "One", hunks: ["h1", "h2"], dropped: undefined },
        { title: "Untitled change", hunks: ["h3"], dropped: undefined },
      ],
    );
    assert.deepStrictEqual([...notFromSession], ["h4"]);
  });
});
