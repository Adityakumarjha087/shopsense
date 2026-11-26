import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "optional" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:20600"),
  title: { default: "ShopSense — AI-powered shopping", template: "%s · ShopSense" },
  description: "Personalised recommendations, semantic search and an AI shopping assistant.",
  openGraph: { title: "ShopSense", description: "AI-powered e-commerce demo", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
    { media: "(prefers-color-scheme: dark)", color: "#14151c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only z-50 rounded bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <Providers>
          <Header />
          <main id="main" className="mx-auto max-w-7xl px-4 py-6">
            {children}
          </main>
          <Footer />
          <AssistantLauncher />
        </Providers>
      </body>
    </html>
  );
}
