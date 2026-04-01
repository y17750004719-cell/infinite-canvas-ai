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
    <html lang="zh-CN">
      <body className="antialiased">
        <ClientErrorReporter />
        {children}
      </body>
    </html>
  );
}
