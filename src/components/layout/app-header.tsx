import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import useTabStore, { selectGlobalStatus } from '@/hooks/use-tab-store';
import AppLogo from '@/components/layout/app-logo';
import { useNotificationCount } from '@/components/features/workspace/notification-sheet';
import EditWorkspaceDialog from '@/components/features/workspace/edit-workspace-dialog';

interface IAppHeaderProps {
  onMenuOpen?: () => void;
  workspaceId?: string;
  workspaceName?: string;
}

const handleLogout = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
};

const AppHeader = ({ onMenuOpen, workspaceId, workspaceName }: IAppHeaderProps) => {
  const t = useTranslations('header');
  const tc = useTranslations('common');
  const hasBusy = useTabStore((s) => selectGlobalStatus(s.tabs).busyCount > 0);
  const { attentionCount, busyCount } = useNotificationCount();
  const sessionsBadge = attentionCount + busyCount;
  const [editOpen, setEditOpen] = useState(false);

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border bg-background px-3"
      data-ui-chrome="header"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {onMenuOpen && (
          <button
            className="relative flex h-8 w-8 shrink-0 items-center justify-center text-foreground"
            onClick={onMenuOpen}
            aria-label={t('openMenu')}
          >
            <Menu className="h-5 w-5" />
            {sessionsBadge > 0 && (
              <span className="absolute -right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded bg-[var(--ui-coral)] px-0.5 text-[9px] font-medium leading-none text-white">
                {sessionsBadge}
              </span>
            )}
          </button>
        )}
        <AppLogo shimmer={hasBusy} />
        {workspaceName && (
          <>
            <span className="text-muted-foreground/40 text-sm">/</span>
            {workspaceId ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="truncate rounded px-1 py-0.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {workspaceName}
              </button>
            ) : (
              <span className="truncate text-sm font-medium text-muted-foreground">{workspaceName}</span>
            )}
          </>
        )}
      </div>

      <TooltipProvider>
        <div className="flex items-center gap-1">
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger
                render={
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                      />
                    }
                  />
                }
              >
                <LogOut className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>{tc('logout')}</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tc('logout')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tc('logoutConfirm')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout}>{tc('logout')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
      {workspaceId && workspaceName && (
        <EditWorkspaceDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          workspaceId={workspaceId}
          currentName={workspaceName}
        />
      )}
    </header>
  );
};

export default AppHeader;
