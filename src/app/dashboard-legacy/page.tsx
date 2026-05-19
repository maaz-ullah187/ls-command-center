import Dashboard from '@/components/Dashboard';

/**
 * Legacy monolithic dashboard kept as a safety net while the new sidebar-based
 * routing in / and /today is being rolled out. Remove once parity is verified.
 */
export default function DashboardLegacyPage() {
  return <Dashboard />;
}
