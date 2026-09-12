// @vitest-environment jsdom

import { createElement, createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalContainer from '@/components/features/workspace/terminal-container';

describe('TerminalContainer', () => {
  afterEach(() => cleanup());

  it('keeps the plain terminal surface when command copying is unavailable', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(createElement(TerminalContainer, { ref }));

    expect(container.querySelector('[data-slot="context-menu-trigger"]')).toBeNull();
    expect(ref.current?.parentElement).toBe(container.firstElementChild);
    expect(screen.queryByText('Copy Command and Output')).toBeNull();
  });

  it('installs the command context menu only when all capability props are present', () => {
    const onContextMenu = vi.fn();
    render(createElement(TerminalContainer, {
      onCommandContextMenu: onContextMenu,
      onCopyCommandAndOutput: vi.fn(),
      copyCommandAndOutputLabel: 'Copy Command and Output',
    }));

    const trigger = document.querySelector('[data-slot="context-menu-trigger"]');
    expect(trigger).not.toBeNull();
    fireEvent.contextMenu(trigger as Element, { clientY: 42 });
    expect(onContextMenu).toHaveBeenCalledWith(42);
  });
});
