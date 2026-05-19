import { vi } from 'vitest';
import type { ExtractedContent } from '../../lib/gemini';

export const mockExtractedContent: ExtractedContent = {
  title: 'Mock Document',
  sections: [
    {
      heading: 'Section 1',
      content: ['Content line 1', 'Content line 2'],
    },
  ],
};

export const mockExtractTextFromFile = vi.fn().mockResolvedValue(mockExtractedContent);

export const mockCreateGeminiClient = vi.fn();

export const createGeminiMocks = () => ({
  extractTextFromFile: mockExtractTextFromFile,
  createGeminiClient: mockCreateGeminiClient,
});

export const resetGeminiMocks = () => {
  mockExtractTextFromFile.mockClear();
  mockExtractTextFromFile.mockResolvedValue(mockExtractedContent);
  mockCreateGeminiClient.mockClear();
};
