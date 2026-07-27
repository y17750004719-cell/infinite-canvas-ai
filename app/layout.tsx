import type { Metadata } from "next";
import ClientErrorReporter from './components/ClientErrorReporter';
import GsapMotionController from './components/GsapMotionController';
import "./globals.css";

export const metadata: Metadata = {
  title: "Z Flow",
  description: "AI 无限画布创作工作区",
  icons: {
    icon: [{ url: "/z-flow-logo.svg", type: "image/svg+xml" }],
    shortcut: "/z-flow-logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" data-workspace-theme="light" suppressHydrationWarning>
      <body className="antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var key = 'zo-design-workspace-theme';
                var theme = window.localStorage.getItem(key) === 'dark' ? 'dark' : 'light';
                document.documentElement.dataset.workspaceTheme = theme;
                document.documentElement.classList.toggle('dark', theme === 'dark');
              } catch (error) {
                document.documentElement.dataset.workspaceTheme = 'light';
                document.documentElement.classList.remove('dark');
              }
            `,
          }}
        />
        <ClientErrorReporter />
        <GsapMotionController />
        {children}
      </body>
    </html>
  );
}
