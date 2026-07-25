import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositorySkill = path.resolve('integrations/open-ocr/skills/open-ocr/SKILL.md');
const packagedSkill = path.resolve('packages/cli/skills/open-ocr/SKILL.md');
const repositoryMetadata = path.resolve('integrations/open-ocr/skills/open-ocr/agents/openai.yaml');
const packagedMetadata = path.resolve('packages/cli/skills/open-ocr/agents/openai.yaml');

// `packages/cli/skills` is generated from `integrations/open-ocr/skills` by
// `scripts/sync-cli-skills.mjs`, which `npm run cli:build` (and therefore
// `prepack`) runs before bundling. The copies stay committed so this suite and
// the npm `files` list work on a fresh checkout; run `npm run cli:build` to
// regenerate them after editing the source skill.
const regenerate = 'packages/cli/skills is generated from integrations/open-ocr/skills — run `npm run cli:build` to regenerate it';

describe('shared Open OCR skill packaging', () => {
  it('keeps the repository and npm skill copies identical', async () => {
    const [sourceSkill, npmSkill, sourceMetadata, npmMetadata] = await Promise.all([
      readFile(repositorySkill, 'utf8'),
      readFile(packagedSkill, 'utf8'),
      readFile(repositoryMetadata, 'utf8'),
      readFile(packagedMetadata, 'utf8'),
    ]);
    expect(npmSkill, regenerate).toBe(sourceSkill);
    expect(npmMetadata, regenerate).toBe(sourceMetadata);
  });
});
