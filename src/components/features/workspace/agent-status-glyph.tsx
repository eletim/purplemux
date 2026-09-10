import { CheckCircle2, Circle, CircleHelp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { TTabDisplayStatus } from '@/types/status';

interface IAgentStatusGlyphProps {
  status: TTabDisplayStatus;
  className?: string;
  showIdle?: boolean;
}

const AgentStatusGlyph = ({ status, className, showIdle = false }: IAgentStatusGlyphProps) => {
  const t = useTranslations('terminal');

  if (status === 'idle' && !showIdle) return null;

  const label = status === 'busy'
    ? t('statusBusy')
    : status === 'needs-input'
      ? t('statusNeedsInput')
      : status === 'ready-for-review'
        ? t('statusNeedsReview')
        : status === 'unknown'
          ? '?'
          : 'idle';

  return (
    <span
      className={cn(
        'agent-status-glyph inline-flex items-center justify-center',
        status === 'busy' && 'text-muted-foreground',
        status === 'needs-input' && 'text-ui-amber',
        status === 'ready-for-review' && 'text-claude-active',
        (status === 'idle' || status === 'unknown') && 'text-muted-foreground/50',
        className,
      )}
      data-agent-status={status}
      role="status"
    >
      {status === 'busy' ? (
        <Spinner className="h-2.5 w-2.5" />
      ) : status === 'needs-input' ? (
        <TriangleAlert className="h-3 w-3 motion-safe:animate-pulse" aria-hidden="true" />
      ) : status === 'ready-for-review' ? (
        <CheckCircle2 className="h-3 w-3 motion-safe:animate-pulse" aria-hidden="true" />
      ) : status === 'unknown' ? (
        <CircleHelp className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Circle className="h-2.5 w-2.5" aria-hidden="true" />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
};

export default AgentStatusGlyph;
