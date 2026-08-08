# 3D Model Licenses

All models in this folder are CC0 1.0 / Public Domain. No attribution is legally
required; sources are documented here for provenance.

## floating-island-large.glb / floating-island-small.glb

- Source: "Floating Island" by cg_world — https://poly.pizza/m/GZKvAswLh6
- Direct file: https://static.poly.pizza/bce8ffb7-ef84-49f3-8a43-4476d7b77032.glb
- Author: cg_world (uploaded to Poly Pizza, Jul 18 2022)
- License: CC0 1.0 (Public Domain) — as listed on the Poly Pizza model page
- Fetched: 2026-08-08
- Modifications: the original single mesh (two islands + debris rocks) was split
  into two GLBs by connected-component analysis; each island recentered at its
  bounding-box center; unused UV attribute removed; debris rocks kept with the
  large island they surround; materials renamed to `Grass` / `Rock`.

## clouds-puffy.glb

- Source: "Clouds" by hat_my_guy — https://poly.pizza/m/gEm9CjnS9l
- Direct file: https://static.poly.pizza/529370b1-994d-4529-b506-ef588ff8e866.glb
- Author: hat_my_guy (uploaded to Poly Pizza)
- License: CC0 1.0 (Public Domain) — as listed on the Poly Pizza model page
- Fetched: 2026-08-08
- Modifications: unused UV attribute removed; each of the three cloud clusters
  recentered so its geometry origin is the cluster center (authored spread kept
  as node translations); nodes/meshes renamed `CloudSmall` / `CloudMedium` /
  `CloudLarge`; material renamed `Cloud`.

## Considered and rejected

- "Low poly floating islands" by vanAchen (https://poly.pizza/m/bH724asZeAh):
  CC-BY 3.0, not CC0 — skipped per licensing policy. All other floating-island
  results on Poly Pizza were CC-BY Google Poly archive imports.
- Quaternius "Cloud" models (CC0, e.g. https://poly.pizza/m/P1cMV8qtN2): fine
  license but smooth-shaded lobed style clashes with the faceted icosphere look.
