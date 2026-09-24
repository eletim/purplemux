import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('prompt-prefix terminal wiring', () => {
  it.each([
    'src/components/features/workspace/pane-container.tsx',
    'src/components/features/mobile/mobile-surface-view.tsx',
  ])('passes the configured prefix through %s', (relativePath) => {
    const source = readSource(relativePath);

    expect(source).toContain('useConfigStore((s) => s.promptPrefix)');
    expect(source).toMatch(/useTerminal\(\{[\s\S]*?promptPrefix,[\s\S]*?\}\)/);
  });

  it('uses the live prefix for prompt markers and sequential copies', () => {
    const source = readSource('src/hooks/use-terminal.ts');

    expect(source).toContain('syncPromptMarkers({');
    expect(source).toContain('promptPrefix: callbacksRef.current.promptPrefix');
    expect(source).toContain('collectPromptBlock({');
    expect(source).toContain("dispatchWheel('down')");
    expect(source).toContain('getNewlyVisiblePromptRows(previousRows, currentRows)');
    expect(source).toContain('restorePromptViewport({');
    expect(source).toMatch(/promptCopyQueue\s*=\s*promptCopyQueue[\s\S]*?\.then\(\(\) => copyPromptBlock\(row\)\)/);
  });

  it('resyncs prompt markers after resetting the terminal', () => {
    const source = readSource('src/hooks/use-terminal.ts');

    expect(source).toMatch(
      /const reset = useCallback\(\(\) => \{[\s\S]*?terminalInstance\.current\?\.reset\(\);\s*promptMarkerSyncRef\.current\(\);/,
    );
  });
});
