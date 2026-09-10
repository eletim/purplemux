import { useEffect } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useUiMode from '@/hooks/use-ui-mode';
import { syncCustomCss } from '@/lib/custom-css';
import { applyUiMode } from '@/lib/ui-mode';

export const UiModeSync = () => {
  const mode = useUiMode((state) => state.mode);
  const hydrated = useUiMode((state) => state.hydrated);
  const hydrate = useUiMode((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) applyUiMode(document.documentElement, mode);
  }, [hydrated, mode]);

  return null;
};

export const CustomCssSync = () => {
  const customCss = useConfigStore((state) => state.customCSS);

  useEffect(() => {
    syncCustomCss(document, customCss);
  }, [customCss]);

  return null;
};
