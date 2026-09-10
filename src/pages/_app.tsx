import "@/styles/globals.css";
import "@/styles/pretendard.css";
import "@xterm/xterm/css/xterm.css";
import "@git-diff-view/react/styles/diff-view.css";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ko";
import "dayjs/locale/ja";
import "dayjs/locale/zh-cn";
import "dayjs/locale/es";
import "dayjs/locale/de";
import "dayjs/locale/fr";
import "dayjs/locale/pt-br";
import "dayjs/locale/zh-tw";
import "dayjs/locale/ru";
import "dayjs/locale/tr";
import type { NextPage } from "next";
import type { AppProps } from "next/app";
import Head from "next/head";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";
import useTerminalTheme from "@/hooks/use-terminal-theme";
import useAgentStatus from "@/hooks/use-agent-status";
import useNativeNotification from "@/hooks/use-native-notification";
import useToastNotification from "@/hooks/use-toast-notification";
import useWebPush from "@/hooks/use-web-push";
import useIsMobile from "@/hooks/use-is-mobile";
import useWorkspaceStore from "@/hooks/use-workspace-store";
import useConfigStore from "@/hooks/use-config-store";
import { setMessages } from "@/lib/i18n";
import { MESSAGE_NAMESPACES } from "@/lib/message-namespaces";
import { CustomCssSync, UiModeSync } from "@/components/root-presentation-sync";

export type TNextPageWithLayout<P = object, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type TAppPropsWithLayout = AppProps & {
  Component: TNextPageWithLayout;
};

const TerminalThemeSync = () => {
  const { theme } = useTerminalTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--terminal-bg', theme.colors.background);
    root.style.setProperty('--terminal-fg', theme.colors.foreground);
  }, [theme]);

  return null;
};

const FONT_SIZE_ROOT: Record<string, string> = {
  normal: '',
  large: '18px',
  'x-large': '20px',
};

const FontSizeSync = () => {
  const fontSize = useConfigStore((s) => s.fontSize);

  useEffect(() => {
    const root = document.documentElement;
    const value = FONT_SIZE_ROOT[fontSize] ?? '';
    root.style.fontSize = value;
  }, [fontSize]);

  return null;
};

const AgentStatusProvider = () => {
  useAgentStatus();
  useNativeNotification();
  useToastNotification();
  useWebPush();
  return null;
};

const MOBILE_TOAST_OFFSET = {
  top: 'calc(env(safe-area-inset-top) + 56px)',
  bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
  left: 16,
  right: 16,
};

const DESKTOP_TOAST_OFFSET = {
  top: 56,
  bottom: 24,
  left: 24,
  right: 24,
};

const ThemedToaster = () => {
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  const positionDesktop = useConfigStore((s) => s.toastPositionDesktop);
  const positionMobile = useConfigStore((s) => s.toastPositionMobile);
  const position = isMobile ? positionMobile : positionDesktop;
  return (
    <Toaster
      position={position}
      theme={resolvedTheme as 'light' | 'dark'}
      offset={isMobile ? MOBILE_TOAST_OFFSET : DESKTOP_TOAST_OFFSET}
      mobileOffset={MOBILE_TOAST_OFFSET}
      closeButton
    />
  );
};

const ElectronTitlebar = ({ isElectron }: { isElectron: boolean }) => {
  if (!isElectron) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
  );
};

export default function App({ Component, pageProps }: TAppPropsWithLayout) {
  const storeHydrated = useRef(false);
  if (!storeHydrated.current && pageProps.initialWorkspace) {
    storeHydrated.current = true;
    useWorkspaceStore.getState().hydrate(pageProps.initialWorkspace);
    useConfigStore.getState().hydrate(pageProps.initialConfig);
  }

  const locale = useConfigStore((s) => s.locale);
  const [messages, setMessagesState] = useState<Record<string, Record<string, unknown>> | null>(
    pageProps.messages ?? null,
  );
  const loadedLocaleRef = useRef<string | null>(null);

  if (pageProps.messages && loadedLocaleRef.current === null) {
    loadedLocaleRef.current = locale;
    setMessages({ [locale]: pageProps.messages });
  }

  useEffect(() => {
    if (loadedLocaleRef.current === locale) return;
    let cancelled = false;
    Promise.all(MESSAGE_NAMESPACES.map((ns) => import(`../../messages/${locale}/${ns}.json`))).then((modules) => {
      if (cancelled) return;
      const msgs = Object.fromEntries(MESSAGE_NAMESPACES.map((ns, i) => [ns, modules[i].default]));
      loadedLocaleRef.current = locale;
      setMessagesState(msgs);
      setMessages({ [locale]: msgs });
    });
    return () => { cancelled = true; };
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (cancelled) return;

      const check = () => {
        if (!document.hidden) reg.update().catch(() => { /* ignore */ });
      };
      document.addEventListener('visibilitychange', check);
      const timer = setInterval(check, 60 * 60 * 1000);

      cleanup = () => {
        document.removeEventListener('visibilitychange', check);
        clearInterval(timer);
      };
    }).catch(() => { /* ignore */ });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  dayjs.extend(relativeTime);
  const dayjsLocaleMap: Record<string, string> = { 'zh-CN': 'zh-cn', 'pt-BR': 'pt-br', 'zh-TW': 'zh-tw' };
  dayjs.locale(dayjsLocaleMap[locale] ?? locale);

  const getLayout = Component.getLayout ?? ((page) => page);

  if (!messages) return null;

  return (
    <NextIntlClientProvider locale={locale} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} messages={messages}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        </Head>
        <main className="font-sans antialiased">
          <ElectronTitlebar isElectron={!!pageProps.isElectron} />
          {getLayout(<Component {...pageProps} />)}
          <UiModeSync />
          <TerminalThemeSync />
          <FontSizeSync />
          <CustomCssSync />
          <AgentStatusProvider />
          <ThemedToaster />
        </main>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
