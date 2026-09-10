import { memo } from 'react';
import useTabStore, { selectTabDisplayStatus } from '@/hooks/use-tab-store';
import useUiMode from '@/hooks/use-ui-mode';
import type { TPanelType } from '@/types/terminal';
import AgentStatusGlyph from '@/components/features/workspace/agent-status-glyph';

interface ITabStatusIndicatorProps {
  tabId: string;
  panelType?: TPanelType;
}

const TabStatusIndicator = ({ tabId, panelType }: ITabStatusIndicatorProps) => {
  const showDismissedCompletion = useUiMode((state) => state.mode === 'mulmo');
  const status = useTabStore(
    (state) => selectTabDisplayStatus(state.tabs, tabId, showDismissedCompletion),
  );

  const isAgent = panelType === 'claude-code' || panelType === 'codex-cli';
  const visible = isAgent && status !== 'idle';

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden transition-all duration-200 ease-in-out"
      style={{
        width: visible ? 12 : 0,
        marginRight: visible ? 0 : -6,
        opacity: visible ? 1 : 0,
      }}
      aria-hidden={!visible || undefined}
    >
      {isAgent && <AgentStatusGlyph status={status} />}
    </span>
  );
};

export default memo(TabStatusIndicator);
