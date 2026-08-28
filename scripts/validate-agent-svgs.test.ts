import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

  it.each([
    ["quoted import", '<svg><style>@import "https://evil.example/x.css";</style></svg>'],
    ["quoted url import", '<svg><style>@import url("https://evil.example/x.css");</style></svg>'],
    ["unquoted url import", '<svg><style>@import url(https://evil.example/x.css);</style></svg>'],
    ["protocol-relative import", '<svg><style>@import "//evil.example/x.css";</style></svg>'],
    ["data import", '<svg><style>@import url(data:text/css,body{});</style></svg>'],
    ["javascript import", '<svg><style>@import "javascript:alert(1)";</style></svg>'],
    ["mixed-case import", '<svg><style>@ImPoRt "https://evil.example/x.css";</style></svg>'],
    ["whitespace import", '<svg><style>@import\n\turl( https://evil.example/x.css );</style></svg>'],
    ["comment-obscured import", '<svg><style>@/**/import/**/url(https://evil.example/x.css);</style></svg>'],
    ["escaped import", '<svg><style>@\\69mport "https://evil.example/x.css";</style></svg>'],
    ["escaped external URL", '<svg><style>.x{fill:u\\72l(https://evil.example/x.svg)}</style></svg>'],
    ["nested style markup", '<svg><style>.x{}<style>@import "https://evil.example/x.css"</style></style></svg>'],
    ["unclosed style markup", '<svg><style>@import "https://evil.example/x.css"</svg>'],
    ["CSS expression", '<svg><style>.x{width:expression(alert(1))}</style></svg>'],
    ["CSS behavior", '<svg><style>.x{behavior:url(#default#VML)}</style></svg>'],
    ["CSS binding", '<svg><style>.x{-moz-binding:url(https://evil.example/x.xml#x)}</style></svg>'],
  ])("rejects unsafe style content: %s", (_description, svg) => {
    expect(validateSvg(svg, "adversarial-style.svg")).not.toEqual([]);
  });

  it.each(["url(#clip)", "url('#clip')", 'url("#clip")'])(
    "accepts the local CSS fragment %s",
    (reference) => {
      expect(validateSvg(`<svg><style>.safe { clip-path: ${reference}; }</style></svg>`, "fragment.svg")).toEqual([]);
    },
  );

  it("accepts internal href fragments", () => {
    expect(validateSvg('<svg><use href="#safe-symbol" /></svg>', "fragment.svg")).toEqual([]);
  });

  it("reports the exact validated CLI scope", () => {
    const output = execFileSync(
      process.execPath,
      [
        new URL("./validate-agent-svgs.mjs", import.meta.url).pathname,
        new URL("../public/agents/pi.svg", import.meta.url).pathname,
        new URL("../public/agents/opencode.svg", import.meta.url).pathname,
      ],
      { encoding: "utf8" },
    );
    expect(output).toBe(
      "Validated 2 SVG file(s): no script/foreignObject/event handlers, unsafe CSS, or non-fragment href/src/url() references.\n",
    );
  });
});
