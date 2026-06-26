import type { Metadata } from "next";
import ClientErrorReporter from './components/ClientErrorReporter';
import "./globals.css";

export const metadata: Metadata = {
  title: "ZO Design Workspace",
  description: "面向设计师与创意团队的 AI 画布工作区",
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
        {children}
      </body>
    </html>
  );
}
