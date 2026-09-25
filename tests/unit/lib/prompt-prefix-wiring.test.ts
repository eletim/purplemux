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
    expect(source).toContain('getNewlyVisiblePromptRows(previousViewport, currentViewport)');
    expect(source).toContain('restorePromptViewport({');
    expect(source).not.toContain('promptCopyQueue');
    expect(source).toContain('if (disposed || gutter.inert) return;');
    expect(source).toContain('gutter.inert = true;');
    expect(source).toContain('for (const finish of [...pendingPromptCopyWaits]) finish();');
    expect(source).toMatch(/if \(!text \|\| disposed \|\| !restored\) return;[\s\S]*?copyToClipboard\(text\)/);
  });

  it('keeps the existing success toast after a prompt block is copied', () => {
    const source = readSource('src/hooks/use-terminal.ts');

    expect(source).toMatch(
      /const ok = await copyToClipboard\(text\);\s*if \(ok && !disposed\) \{\s*toast\.success\(callbacksRef\.current\.t\('copyPaneSuccess'\), \{\s*id: COPY_TOAST_ID,\s*duration: 1500,\s*\}\);/,
    );
  });

  it('keeps exact one-row restoration private to modified synthetic wheel events', () => {
    const config = readSource('src/config/tmux.conf');

    expect(config).toContain('bind -T root C-M-WheelUpPane copy-mode -e');
    expect(config).toContain('bind -T copy-mode    C-M-WheelUpPane   send-keys -X -N 1 scroll-up');
    expect(config).toContain('bind -T copy-mode-vi C-M-WheelUpPane   send-keys -X -N 1 scroll-up');
    expect(config).toContain('bind -T copy-mode    WheelUpPane       send-keys -X -N 3 scroll-up');
  });

  it('resyncs prompt markers after resetting the terminal', () => {
    const source = readSource('src/hooks/use-terminal.ts');

    expect(source).toMatch(
      /const reset = useCallback\(\(\) => \{[\s\S]*?terminalInstance\.current\?\.reset\(\);\s*promptMarkerSyncRef\.current\(\);/,
    );
  });
});
