import { useTranslations } from 'next-intl';
import useUiMode from '@/hooks/use-ui-mode';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';

const UiModeControl = () => {
  const t = useTranslations('settings.appearance');
  const uiMode = useUiMode((s) => s.mode);
  const setUiMode = useUiMode((s) => s.setMode);

  return (
    <ButtonGroup aria-label={t('uiMode')}>
      <Button
        type="button"
        variant={uiMode === 'default' ? 'default' : 'outline'}
        size="sm"
        className="min-h-11 sm:min-h-7"
        aria-pressed={uiMode === 'default'}
        onClick={() => setUiMode('default')}
      >
        {t('uiModeDefault')}
      </Button>
      <Button
        type="button"
        variant={uiMode === 'mulmo' ? 'default' : 'outline'}
        size="sm"
        className="min-h-11 sm:min-h-7"
        aria-pressed={uiMode === 'mulmo'}
        onClick={() => setUiMode('mulmo')}
      >
        {t('uiModeMulmo')}
      </Button>
    </ButtonGroup>
  );
};

export default UiModeControl;
