import { useMemo } from 'react';
import type { ExtractedContent } from '../lib/gemini/types';

interface ExtractedField {
  value: string;
  confidence: number;
  validated?: boolean;
  iteration?: number;
}

interface AgenticOcrResults {
  extractedFields: Record<string, ExtractedField>;
  currentIteration: number;
  progress: number;
  status?: string; // Add status to track completion
}

/**
 * Hook to transform agentic OCR extracted fields into displayable content
 * @param results - The extracted fields from agentic OCR store
 * @returns Formatted content for display and plain text for copying
 */
export function useAgenticOcrResults({ extractedFields, currentIteration, progress, status }: AgenticOcrResults) {

  // Include status in dependencies to trigger updates when agent completes
  const hasResults = useMemo(() => {
    const hasFields = Object.keys(extractedFields).length > 0;
    const isActivelyProcessing = status === 'initializing' || status === 'processing';
    const shouldShow = hasFields || isActivelyProcessing || status === 'completed' || status === 'error';
    // Show results if we have fields OR if actively processing OR if completed
    return shouldShow;
  }, [extractedFields, status]);

  const formattedContent = useMemo<ExtractedContent>(() => {
    // Always check if we have fields to display
    const fieldsCount = Object.keys(extractedFields).length;
    
    if (fieldsCount === 0) {
      // Return empty sections but still show processing message
      return { 
        title: status === 'completed' ? 'No Content Extracted' : 'Processing Document',
        sections: status === 'completed' || status === 'error' ? [{
          heading: 'Status',
          content: [
            status === 'error'
              ? 'The run ended with an error before any fields were surfaced.'
              : 'No fields were extracted from the document. The agent may have encountered an issue.'
          ]
        }] : []
      };
    }
    
    // Create sections from extracted fields
    const sections = Object.entries(extractedFields).map(([fieldName, fieldResult]) => ({
      heading: fieldName,
      content: [
        fieldResult.value || 'No content extracted',
        `Confidence: ${(fieldResult.confidence * 100).toFixed(0)}%`,
        fieldResult.validated ? '✓ Validated' : '⚠️ Needs validation',
        fieldResult.iteration ? `Extracted in iteration ${fieldResult.iteration}` : ''
      ].filter(Boolean)
    }));
    
    // Add statistics section
    const avgConfidence = Object.values(extractedFields).reduce((sum, field) => sum + field.confidence, 0) / Object.values(extractedFields).length || 0;
    
    sections.push({
      heading: 'Extraction Statistics',
      content: [
        `Total Fields: ${fieldsCount}`,
        `Iterations: ${currentIteration}`,
        `Average Confidence: ${(avgConfidence * 100).toFixed(0)}%`,
        `Overall Progress: ${(progress || 0).toFixed(0)}%`,
        status === 'completed'
          ? '✅ Extraction Complete'
          : status === 'stopped'
            ? '⏸ Extraction Stopped'
            : ''
      ].filter(Boolean)
    });
    
    return {
      title: 'Agent Extraction Results',
      sections
    };
  }, [extractedFields, currentIteration, progress, status]);
  
  // Create text content for copying
  const textContent = useMemo(() => {
    const fieldsCount = Object.keys(extractedFields).length;
    if (fieldsCount === 0) return '';
    
    return Object.entries(extractedFields)
      .map(([key, result]) => `${key}: ${result.value}`)
      .join('\n');
  }, [extractedFields]);

  return {
    formattedContent,
    textContent,
    hasResults
  };
}
