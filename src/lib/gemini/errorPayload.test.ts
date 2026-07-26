import { describe, expect, it } from 'vitest';
import {
  parseProviderErrorPayload,
  providerErrorMessage,
  providerErrorPayloadOf,
  providerErrorSubject,
  readableProviderError,
} from './errorPayload';

/**
 * Bodies recorded verbatim from the live Gemini API (gemini-3.1-flash-lite,
 * 2026-07-26). They are the contract this module reads, so keeping them here
 * turns an upstream wording change into a test failure instead of a silent
 * regression back to generic classification.
 */
const LIVE_BODIES = {
  invalidKey: '{"error":{"code":401,"message":"Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.","status":"UNAUTHENTICATED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED","metadata":{"method":"google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent","service":"generativelanguage.googleapis.com"}}]}}',
  corruptImage: '{"error":{"code":400,"message":"Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting","status":"INVALID_ARGUMENT"}}',
  unsupportedMime: '{"error":{"code":400,"message":"Unsupported MIME type: application/x-msdownload","status":"INVALID_ARGUMENT"}}',
  overBudgetSchema: '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
  badThinkingLevel: '{"error":{"code":400,"message":"Invalid value at \'generation_config.thinking_config.thinking_level\' (type.googleapis.com/google.ai.generativelanguage.v1beta.ThinkingConfig.ThinkingLevel), \\"ULTRA\\"","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"field":"generation_config.thinking_config.thinking_level","description":"Invalid value at \'generation_config.thinking_config.thinking_level\'"}]}]}}',
  negativeMaxTokens: '{"error":{"code":400,"message":"* GenerateContentRequest.generation_config.max_output_tokens: max_output_tokens must be positive.\\n","status":"INVALID_ARGUMENT"}}',
  unknownModel: '{"error":{"code":404,"message":"models/gemini-does-not-exist is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.","status":"NOT_FOUND"}}',
} as const;

describe('parseProviderErrorPayload', () => {
  it('reads message, status, code, and ErrorInfo reasons', () => {
    expect(parseProviderErrorPayload(LIVE_BODIES.invalidKey)).toMatchObject({
      code: 401,
      status: 'UNAUTHENTICATED',
      reasons: ['ACCESS_TOKEN_TYPE_UNSUPPORTED'],
      fields: [],
    });
  });

  it('reads BadRequest field violations', () => {
    expect(parseProviderErrorPayload(LIVE_BODIES.badThinkingLevel)?.fields)
      .toEqual(['generation_config.thinking_config.thinking_level']);
  });

  it('recovers a body wrapped in a transport status line', () => {
    expect(parseProviderErrorPayload(`got status: 400 Bad Request. ${LIVE_BODIES.corruptImage}`))
      .toMatchObject({ status: 'INVALID_ARGUMENT', code: 400 });
  });

  it('returns undefined for prose and for JSON that is not an error body', () => {
    expect(parseProviderErrorPayload('Provider request failed with HTTP 500')).toBeUndefined();
    expect(parseProviderErrorPayload('{"choices":[]}')).toBeUndefined();
    expect(parseProviderErrorPayload('{ not json')).toBeUndefined();
  });
});

describe('providerErrorMessage', () => {
  it('replaces a raw body with the sentence the provider wrote', () => {
    const rendered = providerErrorMessage(LIVE_BODIES.invalidKey);
    expect(rendered).toContain('Request had invalid authentication credentials.');
    expect(rendered).not.toContain('type.googleapis.com');
    expect(rendered.length).toBeLessThan(LIVE_BODIES.invalidKey.length);
  });

  it('keeps the machine tokens the sentence does not already carry', () => {
    expect(providerErrorMessage(LIVE_BODIES.invalidKey))
      .toContain('[UNAUTHENTICATED; ACCESS_TOKEN_TYPE_UNSUPPORTED]');
    expect(providerErrorMessage(LIVE_BODIES.corruptImage))
      .toBe('Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting [INVALID_ARGUMENT]');
  });

  it('does not repeat a field the sentence already names', () => {
    const rendered = providerErrorMessage(LIVE_BODIES.badThinkingLevel);
    expect(rendered).toContain('[INVALID_ARGUMENT]');
    expect(rendered.match(/generation_config\.thinking_config\.thinking_level/gu)).toHaveLength(1);
  });

  it('returns non-body text unchanged', () => {
    expect(providerErrorMessage('Gemini request timed out')).toBe('Gemini request timed out');
    expect(providerErrorMessage('')).toBe('');
  });
});

describe('providerErrorPayloadOf', () => {
  /**
   * The Interactions API throws an `ApiError` subclass whose `message` is a
   * content-free "401 API error occurred: {...httpMeta}" summary and whose
   * `body` own-property holds the real payload, wrapped in a JSON array.
   * Recorded live on 2026-07-26.
   */
  const interactionsError = (): Error => Object.assign(
    new Error('401 API error occurred: {"httpMeta":{"response":{},"request":{}}}'),
    {
      name: 'AuthenticationError',
      status: 401,
      body: `[${LIVE_BODIES.invalidKey}]`,
    },
  );

  it('reads the body when the message has nothing in it', () => {
    expect(providerErrorPayloadOf(interactionsError())).toMatchObject({
      status: 'UNAUTHENTICATED',
      reasons: ['ACCESS_TOKEN_TYPE_UNSUPPORTED'],
    });
  });

  it('prefers the message when it already carries the body', () => {
    expect(providerErrorPayloadOf(new Error(LIVE_BODIES.corruptImage))?.status)
      .toBe('INVALID_ARGUMENT');
  });

  it('returns undefined when no property holds an error body', () => {
    expect(providerErrorPayloadOf(new Error('Gemini request timed out'))).toBeUndefined();
    expect(providerErrorPayloadOf('not an object')).toBeUndefined();
  });
});

describe('readableProviderError', () => {
  it('restates the message and keeps the original reachable as cause', () => {
    const original = Object.assign(new Error(LIVE_BODIES.invalidKey), { name: 'ApiError', status: 401 });
    const restated = readableProviderError(original) as Error & { status?: number };
    expect(restated).not.toBe(original);
    expect(restated.message).toContain('Request had invalid authentication credentials.');
    expect(restated.message).not.toContain('type.googleapis.com');
    expect(restated.cause).toBe(original);
    expect(restated.name).toBe('ApiError');
    expect(restated.status).toBe(401);
  });

  it('returns errors that already read well untouched', () => {
    const timeout = new Error('Gemini request timed out');
    expect(readableProviderError(timeout)).toBe(timeout);
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(readableProviderError(abort)).toBe(abort);
  });

  it('is idempotent', () => {
    const once = readableProviderError(Object.assign(new Error(LIVE_BODIES.corruptImage), { status: 400 }));
    expect(readableProviderError(once)).toBe(once);
  });

  it('passes non-errors through', () => {
    expect(readableProviderError('plain string')).toBe('plain string');
    expect(readableProviderError(undefined)).toBeUndefined();
  });
});

describe('providerErrorSubject', () => {
  const subjectOf = (body: string) => {
    const payload = parseProviderErrorPayload(body);
    return payload ? providerErrorSubject(payload) : undefined;
  };

  it('blames the document when the provider names the media', () => {
    expect(subjectOf(LIVE_BODIES.corruptImage)).toBe('input-media');
    expect(subjectOf(LIVE_BODIES.unsupportedMime)).toBe('input-media');
  });

  it('blames a request field when the provider names one', () => {
    expect(subjectOf(LIVE_BODIES.badThinkingLevel)).toBe('request-field');
    expect(subjectOf(LIVE_BODIES.negativeMaxTokens)).toBe('request-field');
  });

  it('blames the model when the provider says it does not exist', () => {
    expect(subjectOf(LIVE_BODIES.unknownModel)).toBe('model');
  });

  it('blames the response schema when a violation names it', () => {
    expect(providerErrorSubject({
      message: 'Invalid value at \'generation_config.response_json_schema\'',
      status: 'INVALID_ARGUMENT',
      reasons: [],
      fields: ['generation_config.response_json_schema'],
    })).toBe('response-schema');
  });

  it('stays unclassified for a bare invalid-argument body', () => {
    // The over-budget response-schema grammar lands here. Nothing in the body
    // distinguishes it from any other malformed request, so guessing would be
    // worse than the generic provider verdict.
    expect(subjectOf(LIVE_BODIES.overBudgetSchema)).toBeUndefined();
  });

  it('stays unclassified for authentication and server failures', () => {
    expect(subjectOf(LIVE_BODIES.invalidKey)).toBeUndefined();
    expect(providerErrorSubject({
      message: 'The service is currently unavailable.',
      status: 'UNAVAILABLE',
      reasons: [],
      fields: [],
    })).toBeUndefined();
  });
});
