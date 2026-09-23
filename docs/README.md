# Documentation And Evidence

Markdown reports in this directory are versioned engineering history. Dates,
runtime revisions, test boundaries and unresolved issues matter: an older PASS
does not certify the current runtime or completion of the entire campaign.

The root [asset manifest](../asset_manifest.json) is also versioned because QA
checks use its source inventory and fingerprints. It contains metadata and short
file-header samples, not complete game assets. Original disc files and generated
web assets remain outside Git; see [GitHub Pages setup](github-pages.md).

## Generated Reports

These generated evidence payloads are intentionally excluded by explicit
filenames in [.gitignore](../.gitignore). Existing local copies are preserved:

- `adapted-tro-census-20260922.json`
- `adapted-tro-openings-20260922.json`
- `browser-adapted-performance-20260922.json`
- `browser-production-destruction-results-20260922.json`
- `browser-type37-census-20260922.json`
- `campaign-adapted-census-20260922.json`
- `campaign-adapted-census-latest-20260922.json`
- `campaign-openings-judge-20260922.json`
- `m02-endjudge-results-20260922.json`
- `m02-rerun-results-20260922.json`
- `sarge-partner-range-20260923.json`

Together they occupy about 65 MiB, mostly full census and replay outputs. Store
them as separately versioned release or CI artifacts when distributing evidence,
and record their download locations and checksums in the corresponding reports.
No external archive has been published as part of this documentation commit.

Consequently, historical links to these JSON files, ignored raw/generated assets,
and absolute `/tmp` paths will not all resolve in a fresh clone. Those links are
retained as original provenance, not promises of downloadable artifacts. Consult
each report's reproduction instructions and environment requirements. New JSON
schemas and hand-maintained metadata are not blanket-ignored.