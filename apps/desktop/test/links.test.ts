import { describe, expect, it } from "vitest";
import { linkAction } from "../src/links";

const APP = "http://127.0.0.1:7420";

describe("Where a link the window is asked to open goes", () => {
  it("stays in the window when it's Fern's own page", () => {
    expect(linkAction(`${APP}/sessions/abc`, APP)).toBe("app");
    expect(linkAction(APP, APP)).toBe("app");
  });

  it("goes to the browser when it only starts like Fern's address", () => {
    expect(linkAction("http://127.0.0.1:7420@evil.com/", APP)).toBe("external");
  });

  it("goes to the browser for web and mail links", () => {
    expect(linkAction("https://github.com/multipletwigs/fern", APP)).toBe(
      "external",
    );
    expect(linkAction("http://localhost:3000/", APP)).toBe("external");
    expect(linkAction("mailto:someone@example.com", APP)).toBe("external");
  });

  it("goes nowhere for any other scheme", () => {
    expect(linkAction("file:///Applications/Calculator.app", APP)).toBe("drop");
    expect(linkAction("smb://attacker/share", APP)).toBe("drop");
    expect(linkAction("javascript:alert(1)", APP)).toBe("drop");
    expect(linkAction("vscode://file/etc/passwd", APP)).toBe("drop");
  });

  it("goes nowhere when it isn't a URL", () => {
    expect(linkAction("not a url", APP)).toBe("drop");
    expect(linkAction("", APP)).toBe("drop");
    expect(linkAction("http://127.0.0.1:74201/", APP)).toBe("drop");
  });
});
