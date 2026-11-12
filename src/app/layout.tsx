import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decisions · A little clarity",
  description: "A human-in-the-loop decision inbox for AI agents.",
  robots: { index: false, follow: false },
  applicationName: "Decisions",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Decisions" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f8f9f7" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
