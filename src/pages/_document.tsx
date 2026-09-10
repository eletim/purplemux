import Document, { Html, Head, Main, NextScript, type DocumentContext, type DocumentInitialProps } from 'next/document';
import { getWorkspaces } from '@/lib/workspace-store';
import { DEFAULT_UI_MODE, UI_MODE_STORAGE_KEY } from '@/lib/ui-mode';

interface IDocumentProps extends DocumentInitialProps {
  activeWorkspaceId: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

class MyDocument extends Document<IDocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<IDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    try {
      const wsData = await getWorkspaces();
      return {
        ...initialProps,
        activeWorkspaceId: wsData.activeWorkspaceId ?? '',
        sidebarWidth: wsData.sidebarWidth,
        sidebarCollapsed: wsData.sidebarCollapsed,
      };
    } catch {
      return { ...initialProps, activeWorkspaceId: '', sidebarWidth: 240, sidebarCollapsed: false };
    }
  }

  render() {
    const sidebarWidth = Number(this.props.sidebarWidth) || 240;
    const sidebarCollapsed = !!this.props.sidebarCollapsed;
    const effectiveWidth = sidebarCollapsed ? 0 : sidebarWidth;
    const effectiveMinWidth = sidebarCollapsed ? 0 : 160;

    const serverActiveWs = JSON.stringify(this.props.activeWorkspaceId || '');
    const initScript = `window.__SB__=(function(){var s=sessionStorage,l=localStorage,t=l.getItem("sidebar-tab"),a=s.getItem("active-ws")||${serverActiveWs};return{w:${sidebarWidth},c:${sidebarCollapsed},t:t==="sessions"?"sessions":"workspace",a:a||""}})()`;
    const uiModeInitScript = `(function(){var m="${DEFAULT_UI_MODE}";try{m=localStorage.getItem(${JSON.stringify(UI_MODE_STORAGE_KEY)})==="mulmo"?"mulmo":m}catch(e){}document.documentElement.setAttribute("data-ui-mode",m)})()`;

    return (
      <Html lang="en" data-ui-mode={DEFAULT_UI_MODE} suppressHydrationWarning>
        <Head>
          <link rel="preload" as="font" type="font/woff2" href="/fonts/PretendardVariable.woff2" crossOrigin="anonymous" />
          <link rel="preload" as="font" type="font/woff2" href="/fonts/MesloLGLDZNerdFont-Regular.woff2" crossOrigin="anonymous" />
          <link rel="preload" as="font" type="font/woff2" href="/fonts/MesloLGLDZNerdFont-Bold.woff2" crossOrigin="anonymous" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <script dangerouslySetInnerHTML={{ __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=Noto+Sans+JP:wght@100..900&display=swap';document.head.appendChild(l)})()` }} />
          <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
          <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
          <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
          <link rel="manifest" href="/api/manifest" />
          <meta name="msapplication-TileColor" content="#131313" />
          <meta name="theme-color" content="#131313" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1320x2868.png" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1206x2622.png" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1179x2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1170x2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1125x2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1242x2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-828x1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-750x1334.png" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-640x1136.png" media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-2048x2732.png" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1668x2388.png" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1640x2360.png" media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1620x2160.png" media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2)" />
          <link rel="apple-touch-startup-image" href="/splash/splash-1488x2266.png" media="(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2)" />
          <style dangerouslySetInnerHTML={{ __html: `:root{--initial-sb-w:${effectiveWidth}px;--initial-sb-mw:${effectiveMinWidth}px}` }} />
          <script dangerouslySetInnerHTML={{ __html: uiModeInitScript }} />
          <script dangerouslySetInnerHTML={{ __html: initScript }} />
          <script dangerouslySetInnerHTML={{ __html: `if(window.electronAPI){document.documentElement.style.setProperty('--titlebar-height','24px');document.documentElement.style.setProperty('--traffic-light-area','82px')}` }} />
        </Head>
        <body className="antialiased">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
