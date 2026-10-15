import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { Fixture, Pr } from "./shape.ts";

// A fake `gh` for an isolated Fern (`pnpm verify:up N --gh-shim`). It answers the calls Fern makes
// (packages/server/src/codehost/CodeHost.ts, packages/server/src/tools/Tools.ts) from the fixture
// `verify:up` wrote, and never runs the real `gh`. Every write, a review posted or a PR opened,
// goes on a line of FERN_GH_SHIM_WRITES instead of to GitHub; reviews posted there are listed back.

const { FERN_GH_SHIM_FIXTURE: served, FERN_GH_SHIM_WRITES: writes } =
  process.env;
if (served === undefined || writes === undefined) {
  process.stderr.write(
    "gh (Fern's verify shim) runs only in a slot: pnpm verify:up N --gh-shim\n",
  );
  process.exit(1);
}
const fixture: Fixture = JSON.parse(readFileSync(served, "utf8"));
// When GitHub takes each write, as GitHub's REST API has it.
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");

// `-R owner/repo` names the repo `gh` already reads from the folder: there's only the one.
const args = process.argv.slice(2).filter((arg, i, all) => {
  if (arg === "-R" || arg === "--repo") return false;
  if (arg.startsWith("--repo=")) return false;
  return all[i - 1] !== "-R" && all[i - 1] !== "--repo";
});

const print = (text: string) =>
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
const refuse = (said: string, printed?: string): never => {
  if (printed !== undefined) print(printed);
  process.stderr.write(`${said}\n`);
  process.exit(1);
};
const notFound = (): never =>
  refuse(
    "gh: Not Found (HTTP 404)",
    JSON.stringify({
      message: "Not Found",
      documentation_url: "https://docs.github.com/rest",
      status: "404",
    }),
  );
const unanswered = (): never =>
  refuse(`gh (Fern's verify shim) has no answer for: gh ${args.join(" ")}`);

// A flag's value, as `--flag value` or `--flag=value`.
const option = (...names: ReadonlyArray<string>) => {
  for (const [i, arg] of args.entries()) {
    if (names.includes(arg)) return args[i + 1];
    const name = names.find((n) => arg.startsWith(`${n}=`));
    if (name !== undefined) return arg.slice(name.length + 1);
  }
  return undefined;
};
const stdin = () => readFileSync(0, "utf8");

const record = (write: object) =>
  appendFileSync(
    writes,
    `${JSON.stringify({ at: now, cwd: process.cwd(), args, ...write })}\n`,
  );
const recorded = (): ReadonlyArray<Record<string, unknown>> =>
  existsSync(writes)
    ? readFileSync(writes, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line))
    : [];

// What `gh` prints for a value: as JSON, or through `--jq`, its strings raw.
const answer = (value: unknown) => {
  const filter = option("--jq", "-q");
  if (filter === undefined) return print(JSON.stringify(value));
  const ran = spawnSync("jq", ["-r", filter], {
    input: JSON.stringify(value),
    encoding: "utf8",
  });
  if (ran.status !== 0) return refuse(`gh: jq: ${ran.stderr.trim()}`);
  return process.stdout.write(ran.stdout);
};

// Only the fields asked for with `--json`, as `gh` gives them; one it doesn't have fails, as there.
const fields = (value: Record<string, unknown>, asked: string) =>
  Object.fromEntries(
    asked.split(",").map((field) => {
      if (!(field in value)) refuse(`Unknown JSON field: "${field}"`);
      return [field, value[field]];
    }),
  );

const prOf = (ref: string | undefined) => {
  const number = Number(/(?:^|\/pull\/)(\d+)$/.exec(ref ?? "")?.[1]);
  const pr = fixture.prs.find((p) => p.number === number);
  if (!pr)
    return refuse(
      `GraphQL: Could not resolve to a PullRequest with the number of ${ref}. (repository.pullRequest)`,
    );
  return pr;
};
const issueUrl = (number: number) =>
  `https://github.com/${fixture.repo}/issues/${number}`;

// A PR as `gh pr list` and `gh pr view` have it.
const ghPr = (pr: Pr) => ({
  number: pr.number,
  url: pr.url,
  title: pr.title,
  author: { login: pr.author, is_bot: false },
  headRefName: pr.head,
  baseRefName: pr.base,
  headRefOid: pr.headCommit,
  isDraft: pr.draft,
  state: pr.state,
  reviewRequests: pr.reviewers.map((login) => ({ __typename: "User", login })),
  body: pr.body,
  closingIssuesReferences: pr.closes.map((number) => ({
    number,
    url: issueUrl(number),
  })),
  mergeStateStatus: pr.draft ? "DRAFT" : "CLEAN",
  mergeable: "MERGEABLE",
  reviewDecision: pr.reviewers.length > 0 ? "REVIEW_REQUIRED" : null,
});

// A PR's reviews, as GitHub's REST API has them: the fixture's, then those posted to the shim.
const reviewsOf = (pr: Pr) => [
  ...pr.reviews.map((r) => ({
    id: r.id,
    user: { login: r.login },
    body: r.body,
    state: r.state,
    commit_id: r.commit,
    html_url: r.url,
    submitted_at: r.submittedAt,
  })),
  ...recorded().flatMap((write) =>
    write.pr === pr.number && write.review !== undefined ? [write.review] : [],
  ),
];

// The flags of `gh api` that take a value.
const VALUED = [
  "-H",
  "--header",
  "-X",
  "--method",
  "--jq",
  "-q",
  "--input",
  "-f",
  "-F",
  "--field",
  "--raw-field",
  "-p",
  "--preview",
  "-t",
  "--template",
  "--hostname",
  "--cache",
];

const api = () => {
  const [endpoint = ""] = args
    .slice(1)
    .filter(
      (arg, i, rest) =>
        !arg.startsWith("-") && !VALUED.includes(rest[i - 1] ?? ""),
    );
  const [path = "", query = ""] = endpoint.replace(/^\//, "").split("?");
  const params = new URLSearchParams(query);
  const method = (
    option("-X", "--method") ??
    (option("--input", "-f", "-F", "--field", "--raw-field") === undefined
      ? "GET"
      : "POST")
  ).toUpperCase();
  if (path === "user" && method === "GET")
    return answer({ login: fixture.login, type: "User" });
  const inRepo = /^repos\/[^/]+\/[^/]+\/(.+)$/.exec(path)?.[1];
  if (inRepo === undefined) return unanswered();

  if (method !== "GET") {
    const input = option("--input");
    const sent =
      input === "-" ? stdin() : input ? readFileSync(input, "utf8") : undefined;
    const posting = /^pulls\/(\d+)\/reviews$/.exec(inRepo);
    if (method === "POST" && posting) {
      const pr = prOf(posting[1]);
      const body = JSON.parse(sent ?? "{}");
      const id = Date.now();
      const review = {
        id,
        user: { login: fixture.login },
        body: body.body ?? "",
        state:
          { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED" }[
            String(body.event)
          ] ?? "COMMENTED",
        commit_id: body.commit_id ?? pr.headCommit,
        html_url: `${pr.url}#pullrequestreview-${id}`,
        submitted_at: now,
      };
      record({ pr: pr.number, sent: body, review });
      return answer(review);
    }
    record({ method, path, sent });
    return answer({});
  }

  if (inRepo === "stacks") {
    if (fixture.stacks === undefined) return notFound();
    const of = params.get("pull_request");
    const page = Number(params.get("page") ?? 1);
    const stacks = fixture.stacks
      .filter((s) => (of === null ? page === 1 : s.prs.includes(Number(of))))
      .map((s) => ({
        id: s.id,
        number: s.number,
        pull_requests: s.prs.map((number) => ({ number })),
      }));
    return answer(stacks);
  }
  const compared = /^compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/.exec(inRepo);
  if (compared) {
    const counted = spawnSync(
      "git",
      ["rev-list", "--count", `${compared[1]}..${compared[2]}`],
      { encoding: "utf8" },
    );
    if (counted.status !== 0) return notFound();
    return answer({ ahead_by: Number(counted.stdout.trim()), behind_by: 0 });
  }
  const pull = /^pulls\/(\d+)(?:\/(files|reviews))?$/.exec(inRepo);
  if (pull) {
    const pr = fixture.prs.find((p) => p.number === Number(pull[1]));
    if (!pr) return notFound();
    if (pull[2] === "files")
      return answer(
        pr.files.map((f) => ({
          filename: f.path,
          status: "modified",
          patch: f.patch,
        })),
      );
    if (pull[2] === "reviews") return answer(reviewsOf(pr));
    return answer({
      number: pr.number,
      html_url: pr.url,
      title: pr.title,
      body: pr.body,
      user: { login: pr.author },
      state: pr.state === "OPEN" ? "open" : "closed",
      draft: pr.draft,
      merged: pr.state === "MERGED",
      merged_at: pr.state === "MERGED" ? "2026-10-12T09:00:00Z" : null,
      head: { ref: pr.head, sha: pr.headCommit },
      base: { ref: pr.base, sha: pr.baseCommit },
    });
  }
  return unanswered();
};

const pr = () => {
  const [, verb, ref] = args;
  const json = option("--json");
  if (verb === "list") {
    const state = option("--state", "-s") ?? "open";
    const listed = fixture.prs
      .filter((p) =>
        state === "all"
          ? true
          : state === "open"
            ? p.state === "OPEN"
            : state === "merged"
              ? p.state === "MERGED"
              : p.state !== "OPEN",
      )
      .toSorted((a, b) => b.number - a.number)
      .slice(0, Number(option("--limit", "-L") ?? 30));
    if (json === undefined)
      return print(
        listed.map((p) => `#${p.number}\t${p.title}\t${p.head}`).join("\n"),
      );
    return answer(listed.map((p) => fields(ghPr(p), json)));
  }
  if (verb === "view") {
    const found = prOf(ref);
    if (json === undefined)
      return print(`${found.title} #${found.number}\n\n${found.body}`);
    return answer(fields(ghPr(found), json));
  }
  if (verb === "create") {
    const body =
      option("--body-file", "-F") === "-" ? stdin() : option("--body", "-b");
    const created = recorded().filter((w) => w.created !== undefined).length;
    const number = Math.max(...fixture.prs.map((p) => p.number)) + 1 + created;
    record({ created: number, body });
    return print(`https://github.com/${fixture.repo}/pull/${number}`);
  }
  if (
    ["edit", "ready", "merge", "close", "reopen", "comment", "review"].includes(
      verb ?? "",
    )
  ) {
    const body = option("--body-file", "-F") === "-" ? stdin() : undefined;
    return record({ body });
  }
  return unanswered();
};

const [command, sub] = args;
if (command === "--version" || command === "version")
  print(
    "gh version 2.99.0-shim (2026-10-12)\nFern's verify shim: no call reaches GitHub",
  );
else if (command === "auth" && sub === "status")
  print(
    `github.com\n  ✓ Logged in to github.com account ${fixture.login} (Fern's verify shim)\n  - Active account: true\n  - Git operations protocol: ssh`,
  );
else if (command === "stack" && sub === "--version")
  print("gh stack version 0.0.0-shim");
else if (
  command === "stack" &&
  (sub === "link" || sub === "merge" || sub === "unstack")
)
  record({});
else if (command === "api") api();
else if (command === "pr") pr();
else if (command === "issue" && sub === "view") {
  const number = Number(/(\d+)$/.exec(args[2] ?? "")?.[1]);
  const issue = fixture.issues?.find((i) => i.number === number);
  if (!issue)
    refuse(
      `GraphQL: Could not resolve to an issue or pull request with the number of ${args[2]}. (repository.issue)`,
    );
  else
    answer(
      fields(
        { ...issue, url: issueUrl(issue.number), state: "OPEN" },
        option("--json") ?? "number,title,body",
      ),
    );
} else if (command === "repo" && sub === "view")
  answer(
    fields(
      {
        defaultBranchRef: { name: fixture.defaultBranch },
        nameWithOwner: fixture.repo,
        name: fixture.repo.split("/")[1],
        owner: { login: fixture.repo.split("/")[0] },
        url: `https://github.com/${fixture.repo}`,
      },
      option("--json") ?? "nameWithOwner,url",
    ),
  );
else unanswered();
