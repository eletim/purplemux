import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('prompt-prefix terminal wiring', () => {
  it('passes the configured prefix through the shared interactive terminal surface', () => {
    const source = readSource('src/hooks/use-terminal-surface.ts');

    expect(source).toContain('useConfigStore((state) => state.promptPrefix)');
    expect(source).toMatch(/useTerminal\(\{[\s\S]*?promptPrefix,[\s\S]*?\}\)/);
  });

  it.each([
    'src/components/features/workspace/pane-container.tsx',
    'src/components/features/mobile/mobile-surface-view.tsx',
    'src/components/features/workspace/terminal-surface.tsx',
  ])('uses the shared interactive terminal surface in %s', (relativePath) => {
    const source = readSource(relativePath);

    expect(source).toContain("import useTerminalSurface from '@/hooks/use-terminal-surface'");
    expect(source).toContain('useTerminalSurface({');
  });

  it('uses the live prefix for prompt markers and copied blocks', () => {
    const source = readSource('src/hooks/use-terminal.ts');

    expect(source).toContain('promptPrefix: callbacksRef.current.promptPrefix');
    expect(source).toContain('getPromptBlockText(buffer, row, callbacksRef.current.promptPrefix)');
  });
});
