import IntegrationsTab from '@/components/IntegrationsTab';

// IntegrationsTab (or one of its children) uses useSearchParams which
// requires CSR bail-out. force-dynamic skips static prerender so Vercel
// stops failing the build with "missing suspense boundary".
export const dynamic = 'force-dynamic';

export default function IntegrationsPage() {
  return (
    <div className="px-6 py-6">
      <IntegrationsTab />
    </div>
  );
}
