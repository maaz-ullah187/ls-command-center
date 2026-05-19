import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";

// Inter via next/font — the operator 2026-04-30 wants the dashboard text "super
// easy to read". Inter is the modern dashboard standard (Stripe, Linear,
// Whop, etc.) — high x-height, clean digit shapes, all weights bundled.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LS Command Center",
  description: "Unified marketing & sales tracking dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased font-sans">
        <Suspense fallback={<div className="min-h-screen bg-[#0a0c0f]" />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
