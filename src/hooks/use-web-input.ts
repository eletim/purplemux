import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import type { TCliState } from '@/types/timeline';
import { isCliIdle } from '@/hooks/use-tab-store';

type TWebInputMode = 'input' | 'interrupt' | 'disabled';

const RESTART_COMMANDS = new Set(['/new', '/clear']);
const DRAFT_KEY_PREFIX = 'pt-input-draft:';

const getDraftKey = (tabId: string) => `${DRAFT_KEY_PREFIX}${tabId}`;

const saveDraft = (tabId: string, value: string) => {
  try {
    if (value) {
      localStorage.setItem(getDraftKey(tabId), value);
    } else {
      localStorage.removeItem(getDraftKey(tabId));
    }
  } catch {
    /* quota exceeded 등 무시 */
  }
};

const loadDraft = (tabId: string): string => {
  try {
    return localStorage.getItem(getDraftKey(tabId)) ?? '';
  } catch {
    return '';
  }
};

const clearDraft = (tabId: string) => {
  try {
    localStorage.removeItem(getDraftKey(tabId));
  } catch {
    /* ignore */
  }
};

interface IUseWebInputReturn {
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  mode: TWebInputMode;
  canSend: boolean;
  send: () => Promise<boolean>;
  interrupt: () => Promise<void>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  focusInput: () => void;
}

interface IUseWebInputOptions {
  tabId?: string;
  onRestartSession?: () => void;
  onMessageSent?: (message: string) => void;
  disabledMessage?: string;
  submitInput: (content: string) => Promise<void>;
  interruptInput: () => Promise<void>;
}

const useWebInput = (
  cliState: TCliState,
  terminalWsConnected: boolean,
  options: IUseWebInputOptions,
): IUseWebInputReturn => {
  const tabId = options?.tabId;
  const [value, setValue] = useState(() => (tabId ? loadDraft(tabId) : ''));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mode: TWebInputMode = useMemo(() => {
    if (isCliIdle(cliState) || cliState === 'unknown') return 'input';
    if (cliState === 'busy' || cliState === 'needs-input') return 'interrupt';
    return 'disabled';
  }, [cliState]);

  const onRestartSession = options?.onRestartSession;
  const onMessageSent = options?.onMessageSent;
  const disabledMessage = options.disabledMessage;
  const submitInput = options.submitInput;
  const interruptInput = options.interruptInput;

  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (!tabId) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => saveDraft(tabId, value), 300);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [tabId, value]);

  const send = useCallback(async (): Promise<boolean> => {
    if (mode === 'disabled') {
      toast.error(disabledMessage ?? t('terminal', 'inputDisabledPlaceholder'));
      return false;
    }

    if (!terminalWsConnected) {
      toast.error(t('connection', 'terminalDisconnected'));
      return false;
    }

    if (value.trim() === '') return false;

    if (RESTART_COMMANDS.has(value.trim().toLowerCase())) {
      onRestartSession?.();
      setValue('');
      if (tabId) clearDraft(tabId);
      return true;
    }

    const message = value;
    setValue('');
    if (tabId) clearDraft(tabId);

    try {
      await submitInput(message);
    } catch (error) {
      setValue((current) => current || message);
      toast.error(error instanceof Error ? error.message : t('terminal', 'inputDisabledPlaceholder'));
      return false;
    }

    if (!message.trim().startsWith('/')) {
      onMessageSent?.(message.trim());
    }
    return true;
  }, [mode, value, terminalWsConnected, onRestartSession, onMessageSent, tabId, disabledMessage, submitInput]);

  const interrupt = useCallback(async () => {
    if (!terminalWsConnected) {
      toast.error(t('connection', 'terminalDisconnected'));
      return;
    }
    try {
      await interruptInput();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('terminal', 'inputDisabledPlaceholder'));
    }
  }, [interruptInput, terminalWsConnected]);

  const focusInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  const canSend = mode !== 'disabled' && terminalWsConnected;

  return {
    value,
    setValue,
    mode,
    canSend,
    send,
    interrupt,
    textareaRef,
    focusInput,
  };
};

export default useWebInput;
export { clearDraft as clearInputDraft };
export type { TWebInputMode };
