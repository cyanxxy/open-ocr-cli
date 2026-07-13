# Changelog

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
