import { handler } from "@repo/server";

// Don't forward Next's route context: Effect would treat it as its own Context.
const route = (request: Request) => handler(request);

export {
  route as GET,
  route as POST,
  route as PUT,
  route as PATCH,
  route as DELETE,
};
