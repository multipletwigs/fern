import { VerifyProcess, VerifySlot, VerifySlotError } from "@repo/api";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Predicate,
  Schema,
} from "effect";
import { homedir } from "node:os";
import { join } from "node:path";

// Where `pnpm verify:up` keeps its slots, one folder per slot number (scripts/verify/slot.ts). It
// is the same for every Fern, an isolated one included, so each lists every slot.
export const VerifySlotsDir = Context.Reference<string>(
  "@repo/server/verify/VerifySlotsDir",
  { defaultValue: () => join(homedir(), ".fern", "verify") },
);

// A slot's manifest as scripts/verify/up.ts writes it (its `SlotManifest`).
const Manifest = Schema.fromJsonString(
  Schema.Struct({
    slot: Schema.Int,
    worktree: Schema.String,
    branch: Schema.NullOr(Schema.String),
    apiPort: Schema.Int,
    webPort: Schema.Int,
    pageUrl: Schema.String,
    pids: Schema.Record(Schema.String, Schema.Int),
    startedAt: Schema.DateTimeUtcFromString,
  }),
);
const decodeManifest = Schema.decodeUnknownEffect(Manifest);

const MANIFEST = "slot.json";

const failed = (message: string) => new VerifySlotError({ message });

// Whether a process with the pid is running. Signalling it fails with EPERM when it runs as
// someone else, and ESRCH when there's none.
const isAlive = (pid: number) =>
  Effect.try({
    try: () => process.kill(pid, 0),
    catch: (error) => ({
      running: Predicate.hasProperty(error, "code") && error.code === "EPERM",
    }),
  }).pipe(
    Effect.as(true),
    Effect.catch(({ running }) => Effect.succeed(running)),
  );

// The isolated Ferns agents start with `pnpm verify:up`, read from the manifests in their slots'
// folders.
export class VerifySlots extends Context.Service<
  VerifySlots,
  {
    // Every slot with at least one of its processes still running, by slot number. A folder with
    // no manifest is a slot that's stopped, or still building before it starts anything.
    readonly running: Effect.Effect<ReadonlyArray<VerifySlot>, VerifySlotError>;
  }
>()("@repo/server/verify/VerifySlots") {
  static readonly layer = Layer.effect(
    VerifySlots,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* VerifySlotsDir;

      const read = Effect.fn("VerifySlots.read")(function* (file: string) {
        const text = yield* fs
          .readFileString(file)
          .pipe(
            Effect.mapError((error) =>
              failed(`Couldn't read ${file}: ${error.message}`),
            ),
          );
        const manifest = yield* decodeManifest(text).pipe(
          Effect.mapError((error) =>
            failed(`${file} isn't a slot manifest: ${error.message}`),
          ),
        );
        const processes = yield* Effect.forEach(
          Object.entries(manifest.pids),
          ([name, pid]) =>
            isAlive(pid).pipe(
              Effect.map((alive) => VerifyProcess.make({ name, pid, alive })),
            ),
        );
        return VerifySlot.make({
          slot: manifest.slot,
          worktree: manifest.worktree,
          branch: manifest.branch,
          apiPort: manifest.apiPort,
          webPort: manifest.webPort,
          pageUrl: manifest.pageUrl,
          processes,
          startedAt: manifest.startedAt,
        });
      });

      const running = Effect.gen(function* () {
        const listed = (fail: { readonly message: string }) =>
          failed(`Couldn't list ${dir}: ${fail.message}`);
        // No folder yet: no slot was ever started.
        if (!(yield* fs.exists(dir).pipe(Effect.mapError(listed)))) return [];
        const entries = yield* fs
          .readDirectory(dir)
          .pipe(Effect.mapError(listed));
        const manifests = yield* Effect.filter(
          entries.map((entry) => path.join(dir, entry, MANIFEST)),
          (file) => fs.exists(file).pipe(Effect.mapError(listed)),
        );
        const slots = yield* Effect.forEach(manifests, read, {
          concurrency: "unbounded",
        });
        return slots
          .filter((slot) => slot.processes.some((p) => p.alive))
          .toSorted((a, b) => a.slot - b.slot);
      }).pipe(Effect.withSpan("VerifySlots.running"));

      return VerifySlots.of({ running });
    }),
  );
}
