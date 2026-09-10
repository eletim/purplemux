import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Spinner from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { TTabDisplayStatus } from '@/types/status';

interface IAgentStatusGlyphProps {
  status: TTabDisplayStatus;
  className?: string;
  compact?: boolean;
  showIdle?: boolean;
}

const AgentStatusGlyph = ({ status, className, compact = false, showIdle = false }: IAgentStatusGlyphProps) => {
  const t = useTranslations('terminal');

  if (status === 'idle' && !showIdle) return null;

  const label = status === 'busy'
    ? t('statusBusy')
    : status === 'needs-input'
      ? t('statusNeedsInput')
      : status === 'ready-for-review'
        ? t('statusNeedsReview')
        : status === 'completed'
          ? t('installDone')
          : status === 'unknown'
            ? '?'
            : 'idle';

  return (
    <span
      className={cn('agent-status-glyph inline-flex items-center justify-center', className)}
      data-agent-status={status}
      role="img"
      aria-label={label}
    >
      <span className="agent-status-glyph-default inline-flex items-center justify-center" aria-hidden="true">
        {status === 'busy' ? (
          <Spinner className={cn(compact ? 'h-2 w-2' : 'h-2.5 w-2.5', 'text-muted-foreground')} />
        ) : status === 'ready-for-review' ? (
          <span className="h-2 w-2 rounded-full bg-claude-active animate-pulse" />
        ) : status === 'needs-input' ? (
          <span className="h-2 w-2 rounded-full bg-ui-amber animate-pulse" />
        ) : status === 'unknown' ? (
          <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        ) : (
          <span className="h-2 w-2 rounded-full border border-muted-foreground/40" />
        )}
      </span>
      <span className="agent-status-glyph-mulmo hidden items-center justify-center" aria-hidden="true">
        {status === 'busy' ? (
          <Spinner className={compact ? 'h-2 w-2' : 'h-2.5 w-2.5'} />
        ) : status === 'needs-input' ? (
          <TriangleAlert className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3', 'motion-safe:animate-pulse')} />
        ) : status === 'ready-for-review' || status === 'completed' ? (
          <CheckCircle2 className={cn(compact ? 'h-2.5 w-2.5' : 'h-3 w-3', 'motion-safe:animate-pulse')} />
        ) : status === 'unknown' ? (
          <span className="h-2 w-2 rounded-full bg-current opacity-50" />
        ) : (
          <span className="h-2 w-2 rounded-full border border-current opacity-50" />
        )}
      </span>
    </span>
  );
};

export default AgentStatusGlyph;
