import { describe, it, expect } from 'vitest';
import {
  detectTable,
  formatAsMarkdownTable,
  formatTablesInContent,
} from './tableFormatter';

describe('tableFormatter', () => {
  describe('detectTable', () => {
    it('should detect markdown table', () => {
      const content = '| Name | Age |\n| --- | --- |\n| John | 25 |';
      const result = detectTable(content);

      expect(result.isTable).toBe(true);
      expect(result.format).toBe('markdown');
      expect(result.hasHeader).toBe(true);
    });

    it('should detect aligned table with multiple spaces', () => {
      const content = 'Name    Age    City\nJohn    25     NYC\nJane    30     LA';
      const result = detectTable(content);

      expect(result.isTable).toBe(true);
      expect(result.format).toBe('aligned');
      expect(result.hasHeader).toBe(true);
    });

    it('should detect delimited table (tab)', () => {
      const content = 'Name\tAge\nJohn\t25\nJane\t30';
      const result = detectTable(content);

      expect(result.isTable).toBe(true);
      expect(result.format).toBe('delimited');
      expect(result.hasHeader).toBe(true);
    });

    it('should detect delimited table (comma)', () => {
      const content = 'Name,Age\nJohn,25\nJane,30';
      const result = detectTable(content);

      expect(result.isTable).toBe(true);
      expect(result.format).toBe('delimited');
      expect(result.hasHeader).toBe(true);
    });

    it('should detect delimited table (pipe)', () => {
      const content = 'Name|Age\nJohn|25\nJane|30';
      const result = detectTable(content);

      expect(result.isTable).toBe(true);
      expect(result.format).toBe('delimited');
      expect(result.hasHeader).toBe(true);
    });

    it('should return none for regular text', () => {
      const content = 'This is just a paragraph of text.';
      const result = detectTable(content);

      expect(result.isTable).toBe(false);
      expect(result.format).toBe('none');
      expect(result.hasHeader).toBe(false);
    });

    it('should return none for empty content', () => {
      const result = detectTable('');

      expect(result.isTable).toBe(false);
      expect(result.format).toBe('none');
      expect(result.hasHeader).toBe(false);
    });

    it('should return none for null/undefined', () => {
      const result = detectTable(null as unknown as string);

      expect(result.isTable).toBe(false);
      expect(result.format).toBe('none');
    });

    it('should return none for single line', () => {
      const result = detectTable('Single line only');

      expect(result.isTable).toBe(false);
      expect(result.format).toBe('none');
    });

    it('should detect markdown table with colon alignment', () => {
      const content = '| Name | Age |\n|:---|---:|\n| John | 25 |';
      const result = detectTable(content);

      expect(result.isTable).toBe(true);
      expect(result.format).toBe('markdown');
    });
  });

  describe('formatTablesInContent', () => {
    it('should format table within content', () => {
      const lines = [
        'Some text before',
        'Name    Age',
        'John    25',
        'Jane    30',
        'Some text after',
      ];

      const result = formatTablesInContent(lines);

      expect(result).toContain('| Name | Age |');
      expect(result).toContain('Some text before');
      expect(result).toContain('Some text after');
    });

    it('should handle empty array', () => {
      const result = formatTablesInContent([]);
      expect(result).toEqual([]);
    });

    it('should handle non-array input', () => {
      const result = formatTablesInContent(null as unknown as string[]);
      expect(result).toEqual([]);
    });

    it('should preserve code blocks', () => {
      const lines = [
        '```js',
        'Name    Age',
        'const x = 1;',
        '```',
        'Normal text',
      ];

      const result = formatTablesInContent(lines);

      expect(result).toContain('```js');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('```');
    });

    it('should preserve code blocks with tilde', () => {
      const lines = ['~~~', 'code here', '~~~'];

      const result = formatTablesInContent(lines);

      expect(result).toContain('~~~');
      expect(result).toContain('code here');
    });

    it('should handle table-like content inside code blocks', () => {
      const lines = [
        '```',
        'Name    Age    City',
        'John    25     NYC',
        '```',
      ];

      const result = formatTablesInContent(lines);

      // Should not convert to markdown table inside code block
      expect(result.join('\n')).not.toContain('|---');
    });

    it('should handle multiple tables', () => {
      const lines = [
        'First table:',
        'A    B    C',
        '1    2    3',
        '',
        'Second table:',
        'X    Y    Z',
        '3    4    5',
      ];

      const result = formatTablesInContent(lines);

      expect(result.join('\n')).toContain('| A | B | C |');
      expect(result.join('\n')).toContain('| X | Y | Z |');
    });

    it('should handle blank lines between content', () => {
      const lines = ['Text 1', '', 'Text 2'];

      const result = formatTablesInContent(lines);

      expect(result).toContain('Text 1');
      expect(result).toContain('Text 2');
    });

    it('should flush table at end of content', () => {
      const lines = [
        'Name    Age    City',
        'John    25     NYC',
      ];

      const result = formatTablesInContent(lines);

      expect(result.join('\n')).toContain('| Name | Age | City |');
    });

    it('should handle pipe-based tables in content', () => {
      const lines = [
        'Before text',
        'Col1|Col2',
        'A|B',
        'After text',
      ];

      const result = formatTablesInContent(lines);

      expect(result.join('\n')).toContain('| Col1 | Col2 |');
    });
  });
  describe('formatAsMarkdownTable', () => {
    it('should format simple tab-separated data', () => {
      const input = 'Name\tAge\tCity\nJohn\t25\tNew York\nJane\t30\tLondon';
      const expected = `| Name | Age | City |
|------|-----|------|
| John | 25 | New York |
| Jane | 30 | London |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should format comma-separated data', () => {
      const input = 'Product,Price,Stock\nLaptop,999,5\nMouse,25,50';
      const expected = `| Product | Price | Stock |
|---------|-------|-------|
| Laptop | 999 | 5 |
| Mouse | 25 | 50 |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should handle pipe-separated data', () => {
      const input = 'ID|Name|Status\n001|Alice|Active\n002|Bob|Inactive';
      const expected = `| ID | Name | Status |
|----|------|--------|
| 001 | Alice | Active |
| 002 | Bob | Inactive |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should handle mixed whitespace and detect best delimiter', () => {
      const input =
        'Header1    Header2    Header3\nValue1     Value2     Value3\nData1      Data2      Data3';
      const result = formatAsMarkdownTable(input);

      expect(result).toContain('| Header1 | Header2 | Header3 |');
      expect(result).toContain('| Value1 | Value2 | Value3 |');
      expect(result).toContain('| Data1 | Data2 | Data3 |');
    });

    it('should handle empty cells', () => {
      const input = 'Name\tAge\tCity\nJohn\t\tNew York\n\t30\tLondon';
      const expected = `| Name | Age | City |
|------|-----|------|
| John |  | New York |
|  | 30 | London |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should handle single column data', () => {
      const input = 'Items\nApple\nBanana\nCherry';
      const expected = `| Items |
|-------|
| Apple |
| Banana |
| Cherry |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should not wrap non-table multi-line text into a spurious single-column table', () => {
      // A stray pipe and a multi-space gap are table signals; a block that
      // failed full table detection must pass through unchanged, not become a
      // bogus one-column table.
      const input = 'Field|\nName  Value';
      const result = formatAsMarkdownTable(input);
      expect(result).toBe(input);
    });

    it('should handle data with quotes', () => {
      const input =
        'Name,Description\n"John Doe","A person with, commas"\n"Jane Smith","Another person"';
      const result = formatAsMarkdownTable(input);

      expect(result).toContain('| Name | Description |');
      expect(result).toContain('| John Doe | A person with, commas |');
      expect(result).toContain('| Jane Smith | Another person |');
    });

    it('should handle inconsistent row lengths', () => {
      const input = 'A\tB\tC\nValue1\tValue2\nShort\nLong\tData\tExtra\tTooMany';
      const result = formatAsMarkdownTable(input);

      expect(result).toContain('| A | B | C |');
      expect(result).toContain('| Value1 | Value2 |');
      expect(result).toContain('| Short |');
      expect(result).toContain('| Long | Data | Extra | TooMany |');
    });

    it('should return original text if no tabular structure detected', () => {
      const input = 'This is just a paragraph of text with no structure.';
      const result = formatAsMarkdownTable(input);

      expect(result).toBe(input);
    });

    it('should handle empty input', () => {
      const result = formatAsMarkdownTable('');
      expect(result).toBe('');
    });

    it('should handle single line input', () => {
      const input = 'Just one line';
      const result = formatAsMarkdownTable(input);
      expect(result).toBe(input);
    });

    it('should handle special characters in cells', () => {
      const input =
        'Symbol\tMeaning\n&\tAmpersand\n<\tLess than\n>\tGreater than';
      const expected = `| Symbol | Meaning |
|--------|---------|
| & | Ampersand |
| < | Less than |
| > | Greater than |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should handle Unicode characters', () => {
      const input =
        'Char\tName\nñ\tN with tilde\né\tE with accent\n中\tChinese character';
      const expected = `| Char | Name |
|------|------|
| ñ | N with tilde |
| é | E with accent |
| 中 | Chinese character |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });

    it('should maintain proper column alignment', () => {
      const input = 'Short\tVery Long Header Name\tMed\nA\tB\tC\nX\tY\tZ';
      const result = formatAsMarkdownTable(input);

      const lines = result.split('\n');
      expect(lines[0]).toContain('| Short | Very Long Header Name | Med |');
      expect(lines[1]).toMatch(/\|[-]+\|[-]+\|[-]+\|/);
      expect(lines[2]).toContain('| A | B | C |');
    });

    it('should handle numerical data properly', () => {
      const input =
        'Item\tPrice\tQuantity\tTotal\nApple\t1.50\t10\t15.00\nBanana\t0.75\t20\t15.00';
      const expected = `| Item | Price | Quantity | Total |
|------|-------|----------|-------|
| Apple | 1.50 | 10 | 15.00 |
| Banana | 0.75 | 20 | 15.00 |`;

      const result = formatAsMarkdownTable(input);
      expect(result).toBe(expected);
    });
  });
});
