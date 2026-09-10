import { describe, expect, it, vi } from 'vitest';
import { CUSTOM_CSS_ELEMENT_ID, syncCustomCss } from '@/lib/custom-css';
import { applyUiMode } from '@/lib/ui-mode';

const createStyleElement = () => ({
  id: '',
  textContent: '',
  remove: vi.fn(),
}) as unknown as HTMLStyleElement;

describe('custom CSS coexistence with UI modes', () => {
  it('retains custom CSS while the root switches between Mulmo and Default', () => {
    const root = { setAttribute: vi.fn() };
    const style = createStyleElement();
    const appendChild = vi.fn();
    const document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => style),
      head: { appendChild },
    };
    const customCSS = ':root { --accent-color: hotpink; }';

    syncCustomCss(document, customCSS);
    applyUiMode(root, 'mulmo');
    applyUiMode(root, 'default');

    expect(style.id).toBe(CUSTOM_CSS_ELEMENT_ID);
    expect(style.textContent).toBe(customCSS);
    expect(appendChild).toHaveBeenCalledOnce();
    expect(root.setAttribute).toHaveBeenNthCalledWith(1, 'data-ui-mode', 'mulmo');
    expect(root.setAttribute).toHaveBeenNthCalledWith(2, 'data-ui-mode', 'default');
  });

  it('updates and removes the existing custom style without creating another', () => {
    const style = createStyleElement();
    const document = {
      getElementById: vi.fn(() => style),
      createElement: vi.fn(),
      head: { appendChild: vi.fn() },
    };

    syncCustomCss(document, 'body { color: rebeccapurple; }');
    expect(style.textContent).toBe('body { color: rebeccapurple; }');
    expect(document.createElement).not.toHaveBeenCalled();

    syncCustomCss(document, '');
    expect(style.remove).toHaveBeenCalledOnce();
  });
});
