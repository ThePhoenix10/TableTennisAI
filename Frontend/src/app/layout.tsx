import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: {
    default: "PongAI",
    template: "%s · PongAI",
  },
  description:
    "Table-tennis video analysis from body pose alone. Every shot timed, attributed, classified and measured.",
  applicationName: "PongAI",
};

export const viewport: Viewport = {
  themeColor: "#e6e0dc",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
      </body>
    </html>
  );
}
