#!/usr/bin/env bash
set -euo pipefail

requested_inputs=()
while IFS= read -r input; do
  if [[ -n "${input//[[:space:]]/}" ]]; then requested_inputs+=("$input"); fi
done <<< "$OPEN_OCR_ACTION_INPUTS"
if [[ ${#requested_inputs[@]} -eq 0 ]]; then
  echo "The inputs value did not contain any document paths." >&2
  exit 2
fi

arguments=(
  extract
  --provider "$OPEN_OCR_ACTION_PROVIDER"
  --gateway "$OPEN_OCR_ACTION_GATEWAY"
  --mode "$OPEN_OCR_ACTION_MODE"
  --format "$OPEN_OCR_ACTION_FORMAT"
  --output "$OPEN_OCR_ACTION_OUTPUT"
)
if [[ -n "$OPEN_OCR_ACTION_MODEL" ]]; then arguments+=(--model "$OPEN_OCR_ACTION_MODEL"); fi
if [[ -n "${OPEN_OCR_ACTION_API_KEY_ENV:-}" ]]; then arguments+=(--api-key-env "$OPEN_OCR_ACTION_API_KEY_ENV"); fi
if [[ -n "${OPEN_OCR_ACTION_BASE_URL:-}" ]]; then arguments+=(--base-url "$OPEN_OCR_ACTION_BASE_URL"); fi
if [[ -n "${OPEN_OCR_ACTION_CLOUDFLARE_ACCOUNT_ID:-}" ]]; then arguments+=(--cloudflare-account-id "$OPEN_OCR_ACTION_CLOUDFLARE_ACCOUNT_ID"); fi
if [[ -n "${OPEN_OCR_ACTION_CLOUDFLARE_GATEWAY_ID:-}" ]]; then arguments+=(--cloudflare-gateway-id "$OPEN_OCR_ACTION_CLOUDFLARE_GATEWAY_ID"); fi
if [[ -n "${OPEN_OCR_ACTION_CLOUDFLARE_PROVIDER:-}" ]]; then arguments+=(--cloudflare-provider "$OPEN_OCR_ACTION_CLOUDFLARE_PROVIDER"); fi
if [[ -n "${OPEN_OCR_ACTION_CLOUDFLARE_TOKEN_ENV:-}" ]]; then arguments+=(--cloudflare-token-env "$OPEN_OCR_ACTION_CLOUDFLARE_TOKEN_ENV"); fi
if [[ "${OPEN_OCR_ACTION_CLOUDFLARE_BYOK:-false}" == "true" ]]; then arguments+=(--cloudflare-byok); fi
if [[ -n "${OPEN_OCR_ACTION_CLOUDFLARE_BYOK_ALIAS:-}" ]]; then arguments+=(--cloudflare-byok-alias "$OPEN_OCR_ACTION_CLOUDFLARE_BYOK_ALIAS"); fi
if [[ -n "$OPEN_OCR_ACTION_PRESET" ]]; then arguments+=(--preset "$OPEN_OCR_ACTION_PRESET"); fi
if [[ "${OPEN_OCR_ACTION_DRY_RUN:-false}" == "true" ]]; then arguments+=(--dry-run); fi

# Document paths are user-controlled and may begin with a dash. Terminate
# Commander option parsing before appending them so a path cannot override
# credential or endpoint flags supplied by the workflow author.
arguments+=(-- "${requested_inputs[@]}")

if [[ -n "${OPEN_OCR_ACTION_PACKAGE:-}" ]]; then
  package_spec="$OPEN_OCR_ACTION_PACKAGE"
else
  action_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
  bundled_version=$(node -p "require(process.argv[1]).version" "$action_root/packages/cli/package.json")
  package_spec="open-ocr-cli@${OPEN_OCR_ACTION_VERSION:-$bundled_version}"
fi
npx --yes --package "$package_spec" -- open-ocr-cli "${arguments[@]}"
