# Contributing

Thanks for contributing to Open OCR CLI and its companion Gemini web app.

## Good First Contributions

- Add or improve eval fixtures under `evals/cases/` and `evals/corpus/`
- Tighten README and docs
- Improve shipped preset copy or result rendering
- Add tests for non-networked logic

Look for issues labeled:

- `good first issue`
- `help wanted`
- `docs`

## Local Setup

```bash
git clone https://github.com/cyanxxy/gemini-ocr.git
cd gemini-ocr
npm ci
npm run dev
```

Before opening a PR, run:

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run evals:validate
npm run evals:matrix:check
npm run cli:install-smoke
```

## Pull Requests

1. Fork the repo and create a focused branch.
2. Keep changes scoped to one concern when possible.
3. Add or update tests for behavior changes.
4. Update docs when user-facing behavior changes.
5. If your change affects templates or evals, include the fixture or report impact in the PR description.

Use [Conventional Commits](https://www.conventionalcommits.org/) when practical.

## Templates And Evals

- New presets should reuse the shared `ExtractionRule` schema.
- New eval cases should use assertion-based checks instead of prose-only expectations.
- OCR quality cases should include a ground-truth reference and objective metric thresholds.
- Do not commit private or sensitive documents to `evals/corpus/`.
- Do not commit `evals/cache/`; use `npm run evals:setup` to reproduce public subsets.
- Keep checked-in reports under `evals/reports/` readable and deterministic.

## Discussions

If Discussions are enabled, use:

- `show-and-tell` for sharing presets or workflows
- `eval-failures` for reporting misses and regressions

## Intentionally Untracked Files

Some files are excluded from the repo on purpose via `.gitignore`, so don't be surprised if you can't find them:

- `AGENTS.md` and `CLAUDE.md` — local AI-agent context, kept per-developer.
- `ROADMAP.md` and `docs/2026-agentic-ocr-evals-plan.md` — internal planning notes that are not maintained as public docs.
- `evals/reports/ocrbench-v2-subset/` — local benchmark artifacts.

You can keep your own copies of these locally, but they will never be committed. Use GitHub Issues and Discussions (not a tracked `ROADMAP.md`) for roadmap and planning conversations.

## Releases

Releases are created from matching semantic version tags after the release
checklist in [docs/releasing.md](docs/releasing.md) is complete:

```bash
git tag v2.0.0
git push origin v2.0.0
```

The release workflow repeats the quality and security gates, publishes the npm
tarball with provenance, builds the container, attaches the Homebrew formula
and web archive, creates the GitHub Release, and updates the matching major
GitHub Action tag.
