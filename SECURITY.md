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

This application requires a Google Gemini API key. Please follow these best practices:

1. **Never commit API keys** to version control
2. **Use environment variables** when possible
3. **Rotate keys regularly** if you suspect they may have been exposed
4. **Use restricted API keys** with only the permissions needed

### Local Storage

The application stores your API key in the browser's localStorage using XOR encryption. While this provides some obfuscation, it is not a substitute for proper secret management. Consider:

- Clearing your browser data when using shared computers
- Using a browser profile dedicated to this application
- Not storing API keys on untrusted devices

### Content Security

- The application processes images and PDFs locally before sending to the Gemini API
- Agent mode requires Gemini's stored Interactions chaining (`previous_interaction_id`); its requests and responses are therefore subject to Google's Interactions data-retention policy. One-shot Web OCR sends `store: false`.
- File size is limited by MIME type: 70MB raw for inline images (safe below the 100MB payload ceiling after base64), 50MB and 1,000 pages for PDFs
- Only supported file types (images, PDFs) are accepted

## Security Features

- **Content Security Policy (CSP)**: Comprehensive CSP headers to prevent XSS attacks
- **Input Validation**: Strict file type and size validation
- **Error Boundaries**: Graceful error handling to prevent information leakage
- **Production Logging**: Sensitive data is sanitized in production logs
