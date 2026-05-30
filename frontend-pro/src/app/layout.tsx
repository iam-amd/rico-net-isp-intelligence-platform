import type { Metadata } from "next";
import React, { Suspense } from "react";
import { RefineContext } from "./_refine_context";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rico Net CMS",
  description: "ISP Management System",
  icons: {
    icon: "/favicon.ico",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Suspense>
          <RefineContext>{children}</RefineContext>
        </Suspense>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
