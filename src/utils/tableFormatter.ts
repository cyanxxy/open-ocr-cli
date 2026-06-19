/**
 * Simplified and optimized table formatting utilities
 * Based on best practices from Vercel AI SDK and OpenAI implementations
 */

interface TableDetectionResult {
  isTable: boolean;
  format: 'markdown' | 'aligned' | 'delimited' | 'none';
  hasHeader: boolean;
}

type Delimiter = '\t' | ',' | '|';

function detectDelimiter(lines: string[]): Delimiter | null {
  const candidates: Delimiter[] = ['\t', ',', '|'];

  for (const delimiter of candidates) {
    const columnCounts = lines.map(line => splitDelimitedLine(line, delimiter).length);
    const linesWithDelimiter = columnCounts.filter(count => count >= 2).length;
    if (linesWithDelimiter >= 2) {
      return delimiter;
    }
  }

  return null;
}

function splitDelimitedLine(line: string, delimiter: Delimiter): string[] {
  if (delimiter === ',') {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        current += '"';
        i++;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim());
    return cells;
  }

  return line.split(delimiter).map(cell => cell.trim());
}

/**
 * Detects if content represents a table and its format
 * More efficient than complex regex patterns
 */
export function detectTable(content: string): TableDetectionResult {
  if (!content || typeof content !== 'string') {
    return { isTable: false, format: 'none', hasHeader: false };
  }

  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    return { isTable: false, format: 'none', hasHeader: false };
  }

  // Check for markdown table format
  const firstLine = lines[0].trim();
  const secondLine = lines[1].trim();
  
  // Markdown table detection
  if (firstLine.includes('|') && secondLine.includes('|')) {
    const isHeaderSeparator = /^\|?\s*:?-+:?\s*\|/.test(secondLine);
    if (isHeaderSeparator) {
      return {
        isTable: true,
        format: 'markdown',
        hasHeader: true
      };
    }
  }

  // Check for space-aligned table (2+ spaces between columns)
  const spaceAlignedPattern = /\S+\s{2,}\S+/;
  let alignedLines = 0;
  
  for (const line of lines.slice(0, 5)) { // Check first 5 lines for performance
    if (spaceAlignedPattern.test(line.trim())) {
      alignedLines++;
    }
  }

  if (alignedLines >= Math.min(2, lines.length * 0.6)) {
    return { isTable: true, format: 'aligned', hasHeader: true };
  }

  const delimiter = detectDelimiter(lines);
  if (delimiter) {
    return { isTable: true, format: 'delimited', hasHeader: true };
  }

  return { isTable: false, format: 'none', hasHeader: false };
}

/**
 * Formats content as a markdown table if applicable
 * Optimized for performance with minimal regex usage
 */
export function formatAsMarkdownTable(content: string): string {
  const detection = detectTable(content);
  
  if (!detection.isTable) {
    const lines = content.trim().split('\n');
    // Only synthesize a single-column table from a clean vertical list: every
    // line must be punctuation-free AND carry no table signals (a pipe or a
    // multi-space gap). Otherwise a multi-line block that merely failed full
    // table detection would be wrongly wrapped into a spurious one-column table.
    const isCleanVerticalList = lines.length > 1 && lines.every(
      line => !/[.!?]/.test(line) && !line.includes('|') && !/\S+\s{2,}\S+/.test(line),
    );
    if (isCleanVerticalList) {
      const rows = lines.map(line => [line.trim()]);
      const header = rows[0][0];
      const separator = '-'.repeat(Math.max(3, header.length + 2));
      return [
        `| ${header} |`,
        `|${separator}|`,
        ...rows.slice(1).map(row => `| ${row[0]} |`)
      ].join('\n');
    }

    return content;
  }

  if (detection.format === 'markdown') {
    // Already markdown, just ensure it's well-formatted
    return content.trim();
  }

  if (detection.format === 'aligned' || detection.format === 'delimited') {
    const lines = content.trim().split('\n');
    const rows: string[][] = [];
    
    const delimiter = detection.format === 'delimited' ? detectDelimiter(lines) : null;

    // Parse rows by splitting on multiple spaces or delimiters
    for (const line of lines) {
      const cells = delimiter
        ? splitDelimitedLine(line, delimiter)
        : line.split(/\s{2,}/).map(cell => cell.trim()).filter(Boolean);

      if (cells.length > 0 && cells.some(cell => cell.length > 0)) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return content;

    // Find max columns
    const maxCols = Math.max(...rows.map(row => row.length));
    
    // Build markdown table
    const result: string[] = [];
    
    // Header row
    const headerCells = rows[0].concat(Array(maxCols - rows[0].length).fill(''));
    const columnWidths = headerCells.map(cell => cell.length);
    result.push('| ' + headerCells.join(' | ') + ' |');
    
    // Separator row
    result.push('|' + columnWidths.map((width) => '-'.repeat(Math.max(3, width + 2))).join('|') + '|');
    
    // Data rows
    for (let i = 1; i < rows.length; i++) {
      const rowCells = rows[i].concat(Array(maxCols - rows[i].length).fill(''));
      result.push('| ' + rowCells.join(' | ') + ' |');
    }
    
    return result.join('\n');
  }

  return content;
}

/**
 * Process lines and format tables where found
 * Optimized version with better performance characteristics
 */
export function formatTablesInContent(lines: string[]): string[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const result: string[] = [];
  let tableBuffer: string[] = [];
  let inTable = false;
  let inCodeFence = false;
  let codeFenceMarker: string | null = null;

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      const tableContent = tableBuffer.join('\n');
      const formatted = formatAsMarkdownTable(tableContent);
      result.push(...formatted.split('\n'));
      tableBuffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(```|~~~)/);

    if (fenceMatch) {
      if (inTable) {
        flushTable();
        inTable = false;
      }

      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceMarker = fenceMatch[1];
      } else if (codeFenceMarker && trimmed.startsWith(codeFenceMarker)) {
        inCodeFence = false;
        codeFenceMarker = null;
      }

      result.push(line);
      continue;
    }

    if (inCodeFence) {
      result.push(line);
      continue;
    }
    const isBlank = trimmed === '';
    
    // Quick check for table-like content
    const looksLikeTable = trimmed.includes('|') || /\S+\s{2,}\S+/.test(trimmed);

    if (looksLikeTable && !isBlank) {
      if (!inTable) {
        inTable = true;
      }
      tableBuffer.push(line);
    } else {
      if (inTable) {
        flushTable();
        inTable = false;
      }
      
      // Add non-table content
      if (!isBlank || result.length === 0 || result[result.length - 1] !== '') {
        result.push(line);
      }
    }
  }

  // Flush any remaining table
  if (inTable) {
    flushTable();
  }

  return result;
}

