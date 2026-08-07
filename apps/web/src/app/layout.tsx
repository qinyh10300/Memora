import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "../styles/tokens.css";
import "../styles/public.css";
import "../styles/workbench.css";
import "../styles/settings.css";
import "../styles/team.css";
import "../styles/capture.css";
import "../styles/library.css";
import "@xyflow/react/dist/style.css";
import "../styles/features.css";
import "../styles/insights.css";
import "../styles/responsive.css";

export const metadata: Metadata = {
  title: "Memora",
  applicationName: "Memora",
  description: "让想法被记住、找到并安全地共享。",
  icons: {
    icon: [{ url: "/memora-logo-owl-minimal-tight.png", type: "image/png" }],
    shortcut: "/memora-logo-owl-minimal-tight.png",
    apple: "/memora-logo-owl-minimal-tight.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
