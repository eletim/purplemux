import { externalServerTmuxTarget } from '@/lib/external-server-tmux';
import { ExternalTerminalClientResource } from '@/lib/external-terminal-client';

const [socketPath, socketIdentity] = process.argv.slice(2);
if (!socketPath || !socketIdentity) throw new Error('Expected socket path and identity');

const main = async (): Promise<void> => {
  await ExternalTerminalClientResource.create(
    externalServerTmuxTarget({ socketPath, socketIdentity }),
    '$0',
    '@0',
    socketIdentity,
  );

  await new Promise(() => {});
};

void main();
