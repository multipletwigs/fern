# Coding standards

Rules for review: judgement calls that no linter or test can make. Mechanical rules live in `pnpm lint` and the tests.

## Security

Fern's trust model is [ADR 0008](docs/adr/0008-fern-trusts-only-its-own-page-and-local-processes.md). `fernRoutes` and `test/origin.test.ts` already enforce that every route sits behind the guard. These rules cover the judgement that's left:

- **Resolve on the server.** An endpoint or Live RPC that spawns a process, touches the filesystem or acts on a Session works out its folder and Session from Fern's own records, from the Session id. It fails for an id Fern doesn't know rather than doing nothing.
- **Bound every fan-out.** A stream that sends one source to many viewers gives each viewer a bounded buffer, with a plan for one that falls behind (resync or drop), and caps how many viewers there can be.
- **Bound every input that reaches native code.** A schema field that ends up in node-pty, a child process's arguments or a buffer has an upper limit: sizes, lengths, counts.
- **Links go through `linkAction`.** Every way the Electron window opens, navigates or redirects to a URL asks `linkAction`, never a string comparison.

For a diff that changes attack surface, also run the second-opinion review in [docs/agents/security-review.md](docs/agents/security-review.md).
