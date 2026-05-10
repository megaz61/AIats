import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI Applicant Tracking System (ATS) | Dashboard",
  description: "AI-Powered Applicant Tracking System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen antialiased`}>
        <nav className="fixed top-0 w-full z-50 glass-panel border-b border-white/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row justify-between items-center h-auto sm:h-16 py-3 sm:py-0 gap-3 sm:gap-0">
              <div className="flex-shrink-0 flex items-center w-full sm:w-auto justify-center sm:justify-start">
                <span className="font-bold text-lg sm:text-xl tracking-tight text-indigo-600 text-center">AI Applicant Tracking System</span>
              </div>
              <div className="flex space-x-4 sm:space-x-8 overflow-x-auto w-full sm:w-auto justify-center sm:justify-end pb-1 sm:pb-0 scrollbar-hide">
                <Link href="/" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors whitespace-nowrap">
                  Dashboard
                </Link>
                <Link href="/jobs" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors whitespace-nowrap">
                  Manage Jobs
                </Link>
                <Link href="/upload" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors whitespace-nowrap">
                  Upload CV
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
