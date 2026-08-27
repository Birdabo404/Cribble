import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The validator is a dependency-free .mjs CLI so provenance commands can run it directly.
import { validateSvg } from "./validate-agent-svgs.mjs";

describe("agent SVG safety validator", () => {
  it.each(["pi.svg", "opencode.svg"])(
    "accepts the shipped official %s asset, including same-document fragments",
    (name) => {
      const svg = readFileSync(new URL(`../public/agents/${name}`, import.meta.url), "utf8");
      expect(validateSvg(svg, name)).toEqual([]);
    },
  );

  it.each([
    ["script elements", '<svg><script>alert(1)</script></svg>'],
    ["namespace-prefixed script elements", '<svg><x:script>alert(1)</x:script></svg>'],
    ["foreignObject elements", '<svg><foreignObject><p>unsafe</p></foreignObject></svg>'],
    ["event handlers", '<svg><path onload="alert(1)" /></svg>'],
    ["namespace-prefixed event handlers", '<svg><path x:onload="alert(1)" /></svg>'],
    ["HTTP url references", '<svg><path fill="url(http://evil.example/a.svg#x)" /></svg>'],
    ["HTTPS url references", '<svg><path fill="url(https://evil.example/a.svg#x)" /></svg>'],
    ["protocol-relative url references", '<svg><path fill="url(//evil.example/a.svg#x)" /></svg>'],
    ["data url references", '<svg><path fill="url(data:image/svg+xml;base64,PHN2Zy8+)" /></svg>'],
    ["javascript url references", '<svg><path fill="url(javascript:alert(1))" /></svg>'],
    ["external href attributes", '<svg><image href="https://evil.example/a.png" /></svg>'],
    ["external src attributes", '<svg><image src="//evil.example/a.png" /></svg>'],
  ])("rejects %s", (_description, svg) => {
    expect(validateSvg(svg, "adversarial.svg")).not.toEqual([]);
  });

  it("accepts internal href fragments", () => {
    expect(validateSvg('<svg><use href="#safe-symbol" /></svg>', "fragment.svg")).toEqual([]);
  });
});
