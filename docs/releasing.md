# Releasing Open OCR CLI

Open OCR CLI uses one semantic version for the root project, npm package, lock
file, GitHub Release, container tag, Homebrew formula, and GitHub Action tag.

## One-time repository setup

1. On npm, configure `open-ocr-cli` to trust the GitHub Actions publisher:
   organization/user `cyanxxy`, repository `open-ocr-cli`, workflow
   `release.yml`, and the `npm publish` permission. The workflow uses a
   GitHub-hosted runner with `id-token: write`; no long-lived npm token is
   required.
2. Ensure GitHub Actions can write repository contents and packages. Enable
   GHCR for the repository and keep tag protection aligned with the maintainers
   allowed to release.
3. Enable GitHub Discussions and the Marketplace listing if those community
   surfaces are wanted. The repository already contains `action.yml`, branding,
   issue forms, and discussion templates.

## Release checklist

1. Update `CHANGELOG.md` and keep the version identical in `package.json`,
   `package-lock.json`, `packages/cli/package.json`, and
   `packages/engine/package.json`. `scripts/assert-release-version.mjs` checks
   every one of those except the private engine package — bump it by hand.
2. Run the local gates:

   ```bash
   npm ci
   npm run typecheck
   npm run lint
   npm run test:coverage
   npm run evals:validate
   npm run evals:matrix:check
   npm run cli:smoke
   npm run cli:install-smoke
   npm run action:smoke
   npx audit-ci --config audit-ci.json
   docker build --tag open-ocr-cli:release-candidate .
   VERSION=3.0.0
   node scripts/assert-release-version.mjs "v$VERSION"
   ```

3. When provider credentials are available, run the canary evaluation matrix
   with a private copy of `evals/providers.example.json`. Review quality,
   latency, and billed-cost deltas before promoting the release.
4. Merge the release commit to `main`, wait for CI, then push the immutable tag:

   ```bash
   VERSION=3.0.0
   git tag "v$VERSION"
   git push origin "v$VERSION"
   ```

5. Confirm the workflow published all five surfaces: npm, GitHub Release,
   `ghcr.io/cyanxxy/open-ocr-cli`, the attached Homebrew formula, and the moving
   `v3` GitHub Action tag. The workflow only moves `v3` forward from an ancestor
   and uses a force-with-lease so a concurrent tag change cannot be overwritten.
   Install from npm and run `open-ocr-cli doctor` once outside the repository.

## Rollback

Never move or overwrite an immutable release tag. If a release is bad,
mark that npm version unusable with a clear message, point the moving `v3`
Action tag back to the last safe v3 release, mark the container tag as affected, and
ship a patch release. Preserve the original release artifacts for auditability.
