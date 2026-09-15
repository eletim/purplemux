import { runWithExistingTab } from '@/lib/layout-store';
import { getProviderByPanelType } from '@/lib/providers';
import { getStatusManager } from '@/lib/status-manager';
import type { ITabStatusEntry } from '@/types/status';

interface IRuntimeTabStatusRegistrar {
  registerTab(tabId: string, entry: ITabStatusEntry): void;
}

export interface IRuntimeTabRegistrationDependencies {
  runWithExistingTab: typeof runWithExistingTab;
  getProviderByPanelType: typeof getProviderByPanelType;
  getStatusManager: () => IRuntimeTabStatusRegistrar;
}

const defaultDependencies: IRuntimeTabRegistrationDependencies = {
  runWithExistingTab,
  getProviderByPanelType,
  getStatusManager,
};

/** Register runtime status only while the persisted tab is protected from removal. */
export const registerExistingRuntimeTab = async (
  workspaceId: string,
  tabId: string,
  dependencies: IRuntimeTabRegistrationDependencies = defaultDependencies,
): Promise<boolean> =>
  dependencies.runWithExistingTab(workspaceId, tabId, (tab) => {
    if (tab.panelType === 'web-browser') return;
    const provider = dependencies.getProviderByPanelType(tab.panelType);
    dependencies.getStatusManager().registerTab(tab.id, {
      cliState: 'inactive',
      workspaceId,
      tabName: tab.name,
      tmuxSession: tab.sessionName,
      panelType: tab.panelType,
      agentProviderId: provider?.id,
      agentSessionId: provider?.readSessionId(tab) ?? null,
      lastEvent: null,
      eventSeq: 0,
    });
  });
