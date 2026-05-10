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
            <div className="flex justify-between h-16 items-center">
              <div className="flex-shrink-0 flex items-center">
                <span className="font-bold text-xl tracking-tight text-indigo-600">AI Applicant Tracking System (ATS) </span>
              </div>
              <div className="flex space-x-8">
                <Link href="/" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">
                  Dashboard
                </Link>
                <Link href="/jobs" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">
                  Manage Jobs
                </Link>
                <Link href="/upload" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">
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
