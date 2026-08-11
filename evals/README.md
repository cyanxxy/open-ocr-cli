# OCR evaluation suite

The suite separates fast behavioral assertions from objective OCR quality
metrics. Local references are versioned; public datasets and timestamped model
outputs remain in ignored directories.

## Commands

```bash
npm run evals:fixtures   # rebuild local PDFs, raster PNGs, and degraded JPEGs
npm run evals:setup      # install deterministic public subsets in evals/cache
npm run evals:validate   # validate cases, inputs, references, and configuration

GEMINI_API_KEY=... npm run evals:canary
GEMINI_API_KEY=... npm run evals
GEMINI_API_KEY=... npm run evals:benchmark
GEMINI_API_KEY=... npm run evals:stability
```

Rebuilding fixtures requires Poppler (`pdftoppm`) plus the Python packages in
`evals/requirements.txt`. The generated fixtures are committed, so ordinary
evaluation runs do not require Python or Poppler.

- `canary` contains the local smoke cases, three raster OCR cases, and five
  cases from each public dataset when installed.
- `full` contains all local cases and all installed public cases.
- `benchmark` contains only installed CORD and OmniDocBench cases.

Pass `--repeat 2` through an npm command or set `EVAL_REPEATS` to collect
multiple samples. `evals:stability` runs the public subset three times. Repeat
indices are preserved in raw artifact names and execution metadata.

`evals:setup` is optional. Local cases continue to work without downloaded
datasets. Re-running setup replaces only the generated `evals/cache` directory.

## Metrics

Text references produce:

- Character error rate (CER), before and after documented OCR normalization
- Word error rate (WER)
- Normalized edit similarity
- Token coverage and unsupported-text rate

Structured references produce exact normalized field precision, recall, and
F1, critical-field exact match, and table-cell F1. Table cells are compared as
a multiset of `column:value` pairs so harmless row serialization differences do
not erase all credit.

Assertions remain useful for hard invariants. `metric_min` and `metric_max`
turn selected objective metrics into case-level gates. The report keeps the
weighted assertion score separate from macro-averaged quality metrics.

Markdown is converted to visible text before OCR scoring. Normalized scoring
uses Unicode NFKC, canonical quotes/dashes, collapsed whitespace, and lowercase
text. Strict CER retains case, punctuation, and line boundaries after Markdown
markers are removed.

## Public datasets

Selections and immutable revisions live in [`datasets.json`](datasets.json).
Sampling seeds are benchmark identifiers, not product branding; keep them
stable unless intentionally publishing a new, documented benchmark corpus.

- CORD v2 is used under CC BY 4.0. The installer selects 20 records from its
  official test split and preserves the supplied OCR and parse annotations.
- OmniDocBench supplies 20 pages stratified across its document source types.
  Its upstream repository does not currently declare a machine-readable
  dataset license. The installer prints this notice, downloads files only into
  the ignored local cache, and does not redistribute them.

Review upstream terms before sharing cached files. Dataset attribution and
source URLs are retained in `datasets.json` and `evals/cache/installed.json`.

## Run artifacts

Every live run writes:

- `evals/reports/latest.json` and `latest.md`
- Raw output per case under `evals/reports/runs/<timestamp>/`
- Per-case runtime errors, duration, API requests, token usage, agent iterations,
  and processing-step count
- Aggregate metrics split by OCR mode and tags

Estimated cost is included when both `EVAL_INPUT_USD_PER_MILLION` and
`EVAL_OUTPUT_USD_PER_MILLION` are set. Rates are deliberately supplied by the
caller instead of hard-coded because Gemini pricing and context tiers can
change. Thinking tokens are counted with output; tool-use prompt tokens are
counted with input.
