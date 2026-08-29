const requestTabInput = async (
  operation: 'submit' | 'interrupt',
  workspaceId: string,
  tabId: string,
  body?: Record<string, unknown>,
): Promise<void> => {
  const response = await fetch(
    `/api/tabs/${encodeURIComponent(tabId)}/${operation}?workspaceId=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (response.ok) return;
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(payload?.error ?? `Tab ${operation} failed (${response.status})`);
};

export const submitTabInputFromBrowser = (
  workspaceId: string,
  tabId: string,
  content: string,
): Promise<void> => requestTabInput('submit', workspaceId, tabId, { content });

export const interruptTabFromBrowser = (
  workspaceId: string,
  tabId: string,
): Promise<void> => requestTabInput('interrupt', workspaceId, tabId);
