import { Option } from "effect";

// An `origin` on GitHub, over SSH or HTTPS: its owner and name.
const ON_GITHUB =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

// The repo on GitHub an `origin` URL names, as "owner/name"; none for one off GitHub.
export const gitHubRepo = (url: string): Option.Option<string> => {
  const found = ON_GITHUB.exec(url.trim());
  return found?.[1] && found[2]
    ? Option.some(`${found[1]}/${found[2]}`)
    : Option.none();
};
