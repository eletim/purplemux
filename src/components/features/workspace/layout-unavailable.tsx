import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LayoutUnavailable = ({
  message,
  retryLabel,
  onRetry,
  surface,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  surface: 'desktop' | 'mobile';
}) => (
  <div
    data-layout-state="unavailable"
    data-layout-surface={surface}
    className={cn(
      'flex flex-col items-center justify-center gap-3',
      surface === 'mobile' ? 'flex-1' : 'h-full',
    )}
  >
    <AlertTriangle className="h-5 w-5 text-ui-amber" />
    <span className="text-sm text-muted-foreground">{message}</span>
    <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
      <RefreshCw className="h-3.5 w-3.5" />
      {retryLabel}
    </Button>
  </div>
);

export default LayoutUnavailable;
