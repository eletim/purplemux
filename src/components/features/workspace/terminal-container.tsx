import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { Copy } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface ITerminalContainerProps {
  className?: string;
  minHeight?: number;
  onCopyCommandAndOutput?: () => void;
  onCommandContextMenu?: (clientX: number, clientY: number) => void;
  copyCommandAndOutputLabel?: string;
}

const TerminalContainer = forwardRef<HTMLDivElement, ITerminalContainerProps>(
  ({ className, minHeight, onCopyCommandAndOutput, onCommandContextMenu, copyCommandAndOutputLabel }, ref) => {
    const terminal = (
      <div
        ref={ref}
        className="min-w-0 h-full w-full overflow-hidden"
        style={minHeight ? { minHeight } : undefined}
      />
    );
    const containerClassName = cn(
      'min-w-0 h-full w-full overflow-hidden p-2 flex flex-col justify-end',
      className,
    );

    if (!onCopyCommandAndOutput || !onCommandContextMenu || !copyCommandAndOutputLabel) {
      return <div className={containerClassName}>{terminal}</div>;
    }

    return (
      <ContextMenu>
        <ContextMenuTrigger
          render={<div />}
          className={cn(containerClassName, 'select-text')}
          onContextMenu={(event) => onCommandContextMenu(event.clientX, event.clientY)}
        >
          {terminal}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onCopyCommandAndOutput}>
            <Copy className="mr-2 h-3.5 w-3.5" />
            {copyCommandAndOutputLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  },
);

TerminalContainer.displayName = 'TerminalContainer';

export default TerminalContainer;
