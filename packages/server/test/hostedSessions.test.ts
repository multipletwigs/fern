import { assert, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseLive } from "../src/database/Database";
import { HostedSessions } from "../src/turn/HostedSessions";

// One Session the developer ran in a terminal, one Fern started, and one some other script ran.
// Claude Code records the last two as headless SDK Sessions.
const TERMINAL = "11111111-1111-4111-8111-111111111111";
const FERN = "22222222-2222-4222-8222-222222222222";
const SCRIPT = "33333333-3333-4333-8333-333333333333";

const configDir = mkdtempSync(join(tmpdir(), "fern-claude-"));
const write = (
  folder: string,
  id: string,
  entrypoint: string,
  minute: number,
) => {
  const dir = join(configDir, "projects", folder.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "user",
      uuid: crypto.randomUUID(),
      parentUuid: null,
      sessionId: id,
      timestamp: `2026-10-11T10:0${minute}:00.000Z`,
      cwd: folder,
      entrypoint,
      userType: "external",
      message: { role: "user", content: `Session ${id}` },
    })}\n`,
  );
  // Claude Code dates a Session by when its transcript was last written.
  const at = new Date(`2026-10-11T10:0${minute}:00.000Z`);
  utimesSync(file, at, at);
};
write("/work/app", TERMINAL, "cli", 1);
write("/work/new", FERN, "sdk-cli", 2);
write("/work/app", SCRIPT, "sdk-ts", 3);
process.env.CLAUDE_CONFIG_DIR = configDir;

layer(HostedSessions.layer.pipe(Layer.provide(DatabaseLive(":memory:"))))(
  "HostedSessions",
  (it) => {
    it.effect("lists only the developer's Sessions until Fern starts one", () =>
      Effect.gen(function* () {
        const sessions = yield* HostedSessions;
        const ids = (yield* sessions.listed).map((info) => info.sessionId);
        assert.deepStrictEqual(ids, [TERMINAL]);
        assert.isFalse(yield* sessions.isProject("/work/new"));
      }),
    );

    it.effect(
      "lists a Session Fern started, newest first, and its folder as a Project",
      () =>
        Effect.gen(function* () {
          const sessions = yield* HostedSessions;
          yield* sessions.record(FERN, "/work/new");
          const ids = (yield* sessions.listed).map((info) => info.sessionId);
          assert.deepStrictEqual(ids, [FERN, TERMINAL]);
          assert.isTrue(yield* sessions.isProject("/work/new"));
        }),
    );
  },
);
