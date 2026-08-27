#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const INTERNAL_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;

function validateCss(css, name, errors) {
  if (css.includes("<") || css.includes("\\")) {
    errors.push(`${name}: forbidden markup or escape in CSS`);
    return;
  }

  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (withoutComments.includes("/*") || withoutComments.includes("*/")) {
    errors.push(`${name}: malformed CSS comment`);
  }

  for (const match of withoutComments.matchAll(/@\s*([A-Za-z-]*)/g)) {
    if (match[1].toLowerCase() !== "media") {
      errors.push(`${name}: forbidden CSS at-rule: @${match[1]}`);
    }
  }

  if (/(?:\bexpression\s*\(|(?:^|[;{\s])behavior\s*:|-moz-binding\s*:)/i.test(withoutComments)) {
    errors.push(`${name}: forbidden active CSS`);
  }
}

/**
 * Validate the active-content and external-reference boundary for a static SVG.
 * Same-document fragment references are allowed; every other URL is rejected.
 * @param {string} svg
 * @param {string} [name]
 * @returns {string[]}
 */
export function validateSvg(svg, name = "SVG") {
  const errors = [];

  if (/<\s*(?:[A-Za-z_][\w.-]*:)?(?:script|foreignObject)\b/i.test(svg)) {
    errors.push(`${name}: forbidden script or foreignObject element`);
  }

  if (/\s+(?:[A-Za-z_][\w.-]*:)?on[a-z][a-z0-9_.:-]*\s*=/i.test(svg)) {
    errors.push(`${name}: forbidden event-handler attribute`);
  }

  const styleElements = [
    ...svg.matchAll(/<\s*(?:[A-Za-z_][\w.-]*:)?style\b[^>]*>([\s\S]*?)<\s*\/\s*(?:[A-Za-z_][\w.-]*:)?style\s*>/gi),
  ];
  const styleOpenings = svg.match(/<\s*(?:[A-Za-z_][\w.-]*:)?style\b[^>]*>/gi) ?? [];
  if (styleOpenings.length !== styleElements.length) {
    errors.push(`${name}: malformed or nested style element`);
  }
  for (const match of styleElements) {
    validateCss(match[1], name, errors);
  }

  for (const match of svg.matchAll(/\bstyle\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gis)) {
    validateCss(match[2] ?? match[3] ?? "", name, errors);
  }

  for (const match of svg.matchAll(/\burl\(\s*(["']?)(.*?)\1\s*\)/gis)) {
    const reference = match[2].trim();
    if (!INTERNAL_FRAGMENT.test(reference)) {
      errors.push(`${name}: external or unsafe url() reference: ${reference}`);
    }
  }

  for (const match of svg.matchAll(/\b(?:href|src)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gis)) {
    const reference = (match[2] ?? match[3] ?? "").trim();
    if (!INTERNAL_FRAGMENT.test(reference)) {
      errors.push(`${name}: external or unsafe href/src reference: ${reference}`);
    }
  }

  return errors;
}

export function validateFiles(paths) {
  return paths.flatMap((path) => validateSvg(readFileSync(path, "utf8"), path));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: node scripts/validate-agent-svgs.mjs <svg> [svg ...]");
    process.exitCode = 2;
  } else {
    const errors = validateFiles(paths);
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(
        `Validated ${paths.length} SVG file(s): no script/foreignObject/event handlers, unsafe CSS, or non-fragment href/src/url() references.`,
      );
    }
  }
}
