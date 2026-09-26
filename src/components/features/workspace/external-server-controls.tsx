import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { IExternalServerControls } from '@/hooks/use-external-workspace-source';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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

export default function ExternalServerControls({
  controls,
}: {
  controls: IExternalServerControls;
}) {
  const [registerOpen, setRegisterOpen] = useState(false);
  const selected = controls.servers.find((server) => server.id === controls.selectedServerId) ?? null;

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const registered = await controls.registerServer({
      name: String(fields.get('name') ?? ''),
      socketPath: String(fields.get('socketPath') ?? ''),
    });
    if (registered) {
      form.reset();
      setRegisterOpen(false);
    }
  };

  return (
    <section className="space-y-2 border-b border-sidebar-border p-2.5" aria-label="External tmux servers">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="external-server-select" className="text-[11px] font-medium tracking-wide text-muted-foreground">
          REGISTERED SERVER
        </label>
        <div className="flex items-center gap-0.5">
          <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent"
                  aria-label="Register external server"
                />
              }
            >
              <Plus className="h-3.5 w-3.5" />
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={register} className="contents">
                <DialogHeader>
                  <DialogTitle>Register external tmux server</DialogTitle>
                  <DialogDescription>
                    Add an existing tmux server by its absolute socket path.
                  </DialogDescription>
                </DialogHeader>
                <label className="space-y-1 text-sm">
                  <span>Name</span>
                  <Input name="name" required autoFocus />
                </label>
                <label className="space-y-1 text-sm">
                  <span>Absolute socket path</span>
                  <Input name="socketPath" required pattern="/.*" placeholder="/absolute/path/to/tmux/socket" />
                </label>
                <DialogFooter>
                  <Button type="submit" disabled={controls.isMutating}>Register</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-sidebar-accent disabled:opacity-40"
                  aria-label="Unregister selected server"
                  disabled={!selected || controls.isMutating}
                />
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unregister {selected?.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes only the purplemux registration. The external tmux server and its sessions are not changed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={controls.isMutating}
                  onClick={() => void controls.unregisterServer()}
                >
                  Unregister
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <select
        id="external-server-select"
        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        value={controls.selectedServerId ?? ''}
        disabled={controls.isLoading || controls.servers.length === 0}
        onChange={(event) => controls.selectServer(event.target.value)}
      >
        {controls.servers.length === 0 && <option value="">No registered servers</option>}
        {controls.servers.map((server) => (
          <option key={server.id} value={server.id}>
            {server.name}{server.exists ? '' : ' (unavailable)'}
          </option>
        ))}
      </select>
      {selected && (
        <p className="truncate text-[11px] text-muted-foreground" title={selected.socketPath}>
          {selected.socketPath}
        </p>
      )}
      {controls.error && <p className="text-xs text-ui-red" role="alert">{controls.error}</p>}
    </section>
  );
}
