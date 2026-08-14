# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security Advisories](https://github.com/cyanxxy/open-ocr-cli/security/advisories) page
2. Click "Report a vulnerability"
3. Fill out the form with details about the vulnerability

### What to Include

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: We will acknowledge your report within 48 hours
- **Updates**: We will keep you informed about our progress
- **Resolution**: We aim to resolve critical vulnerabilities within 7 days
- **Credit**: We will credit you in the release notes (unless you prefer to remain anonymous)

## Security Best Practices for Users

### API Key Handling

This tool requires a provider API key (Gemini, Moonshot, Meta, or OpenRouter).
Please follow these best practices:

1. **Never commit API keys** to version control
2. **Rotate keys regularly** if you suspect they may have been exposed
3. **Use restricted API keys** with only the permissions needed

### How the CLI Reads Credentials

Keys are read **only** from an environment variable, named by the `apiKeyEnv`
config setting (default `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `META_API_KEY`, or
`OPENROUTER_API_KEY`). The CLI never accepts a raw key as a command-line
argument or a config-file value, and never writes one to a config file, a run
record, an artifact, or a log line. Consider:

- Keeping keys in your shell profile or a secret manager, not in shell history
- Using `--no-config` (or `OPEN_OCR_NO_CONFIG=1`) for a hermetic run
- Running `open-ocr-cli doctor` to confirm which variable is being read, without
  printing its value

There is no browser storage of any kind. The React web app that stored a key in
`localStorage` was removed from this repository; if you deployed that app from an
older revision, rotate any key you entered into it.

### Content Security

- Documents are read locally and sent directly to the configured provider API
- Agent mode requires Gemini's stored Interactions chaining (`previous_interaction_id`); its requests and responses are therefore subject to Google's Interactions data-retention policy. One-shot Web OCR sends `store: false`.
- File size is limited by MIME type: 70MB raw for inline images (safe below the 100MB payload ceiling after base64), 50MB and 1,000 pages for PDFs
- Only supported file types (images, PDFs) are accepted

## Security Features

- **Credential Isolation**: Keys are read from environment variables only, never serialized or echoed
- **Input Validation**: Strict file type and size validation
- **SSRF Protection**: URL extraction blocks private ranges, link-local, and tunnel hosts, and pins DNS across redirects
- **Untrusted Output**: Extracted document text is treated as third-party content, never as instructions to the calling agent
- **Production Logging**: Sensitive data is sanitized in production logs
