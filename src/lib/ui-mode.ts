export const UI_MODE_STORAGE_KEY = 'purplemux-ui-mode';
export const UI_MODE_ATTRIBUTE = 'data-ui-mode';

export const UI_MODES = ['default', 'mulmo'] as const;
export type TUiMode = (typeof UI_MODES)[number];

export const DEFAULT_UI_MODE: TUiMode = 'default';

export const createUiModeInitScript = (): string =>
  `(function(){var m="${DEFAULT_UI_MODE}";try{m=localStorage.getItem(${JSON.stringify(UI_MODE_STORAGE_KEY)})==="mulmo"?"mulmo":m}catch(e){}document.documentElement.setAttribute(${JSON.stringify(UI_MODE_ATTRIBUTE)},m)})()`;

export const resolveUiMode = (value: unknown): TUiMode =>
  value === 'mulmo' ? 'mulmo' : DEFAULT_UI_MODE;

export const applyUiMode = (
  root: Pick<HTMLElement, 'setAttribute'>,
  mode: TUiMode,
) => {
  root.setAttribute(UI_MODE_ATTRIBUTE, mode);
};

export const shouldDismissViewedStatus = (mode: TUiMode, hydrated: boolean): boolean =>
  hydrated && mode !== 'mulmo';
