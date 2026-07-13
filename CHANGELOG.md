# Changelog

## 1.3.0 - 2026-07-13

### Current Gemini model and API support

- Gemini 3.5 Flash is now the recommended default model, with updated thinking
  defaults and model-specific reasoning controls.
- Agentic OCR now follows the stateful Interactions API continuation protocol,
  preserves server interaction IDs, and sends documented function-result
  content blocks without retransmitting the original document.
- Retry handling can resume pending user or tool-result input after transient
  Gemini failures without duplicating completed work.

### Safer document processing and better extraction

- Inline image uploads are capped at 70 MB raw so base64 expansion and request
  metadata remain below Gemini's 100 MB request ceiling.
- PDFs are validated against the 50 MB and 1,000-page document limits before
  processing when local page inspection is available.
- Template extraction now uses JSON response schemas, improved typed field
  normalization, and complete usage accounting for streamed responses.

### Interface improvements

- Mobile navigation now uses a dedicated full-width row with accessible touch
  targets and no horizontal overflow.
- Template selection is compact on small screens so the upload action remains
  visible without scrolling through four full-size cards.
- Settings expose reasoning controls earlier, use consistent icons, and provide
  a larger close target.
- Page titles now match their navigation labels: Simple OCR, Template OCR, Web
  OCR, Bulk OCR, and Agentic OCR.

### Upgrade notes

No application settings or stored OCR results need to be migrated.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.2.0...v1.3.0)

## 1.2.0 - 2026-07-13

### More trustworthy OCR quality checks

- OCR quality is now measured against complete ground truth instead of relying
  only on a handful of expected words.
- New quality scores cover character and word accuracy, missing text,
  unsupported text, structured fields, critical fields, and table cells.
- Clean PDFs are now tested alongside text-layer-free page images and
  automatically degraded scans, giving future OCR changes a more realistic
  safety net.

### Real-world benchmark support

- A single setup command prepares reproducible subsets of CORD receipts and
  OmniDocBench pages without committing downloaded documents to the project.
- Canary, full, benchmark, and repeated stability runs make it easier to check
  a quick change or compare OCR behavior more thoroughly.
- Reports now include per-mode quality, latency, Gemini token usage, optional
  cost estimates, variation across repeated runs, and raw outputs for failed
  cases.

### Fixture correction

- The sample business card is now correctly generated as one page instead of
  splitting its contact information across two pages.

### Upgrade notes

No application settings or stored OCR results need to be migrated. Public
benchmark downloads are optional; the bundled local evaluation suite works on
its own.

[Full comparison](https://github.com/cyanxxy/gemini-ocr/compare/v1.1.0...v1.2.0)
