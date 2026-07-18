import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositorySkill = path.resolve('integrations/open-ocr/skills/open-ocr/SKILL.md');
const packagedSkill = path.resolve('packages/cli/skills/open-ocr/SKILL.md');
const repositoryMetadata = path.resolve('integrations/open-ocr/skills/open-ocr/agents/openai.yaml');
const packagedMetadata = path.resolve('packages/cli/skills/open-ocr/agents/openai.yaml');

describe('shared Open OCR skill packaging', () => {
  it('keeps the repository and npm skill copies identical', async () => {
    const [sourceSkill, npmSkill, sourceMetadata, npmMetadata] = await Promise.all([
      readFile(repositorySkill, 'utf8'),
      readFile(packagedSkill, 'utf8'),
      readFile(repositoryMetadata, 'utf8'),
      readFile(packagedMetadata, 'utf8'),
    ]);
    expect(npmSkill).toBe(sourceSkill);
    expect(npmMetadata).toBe(sourceMetadata);
  });
});
