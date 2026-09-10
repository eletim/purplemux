export const UI_MODE_STORAGE_KEY = 'purplemux-ui-mode';
export const UI_MODE_ATTRIBUTE = 'data-ui-mode';

export const UI_MODES = ['default', 'mulmo'] as const;
export type TUiMode = (typeof UI_MODES)[number];

export const DEFAULT_UI_MODE: TUiMode = 'default';

export const resolveUiMode = (value: unknown): TUiMode =>
  value === 'mulmo' ? 'mulmo' : DEFAULT_UI_MODE;

export const applyUiMode = (
  root: Pick<HTMLElement, 'setAttribute'>,
  mode: TUiMode,
) => {
  root.setAttribute(UI_MODE_ATTRIBUTE, mode);
};
