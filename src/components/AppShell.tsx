'use client';

import { Suspense } from 'react';
import Sidebar from './Sidebar';
import AIChatPanel from './AIChatPanel';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Phase 0 shell: persistent sidebar + content area. AI chat panel floats above all routes.
 */
export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-[#0a0c0f] text-gray-200">
      <Suspense fallback={<div className="w-56 shrink-0 bg-[#0d0f12] border-r border-gray-800" />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 min-w-0 overflow-x-hidden">
        {children}
      </main>
      <Suspense fallback={null}>
        <AIChatPanel activeTab="main" />
      </Suspense>
    </div>
  );
}
