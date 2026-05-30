import ONUTable from '../components/dashboard/ONUTable';

export default function ONUListPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-200">All ONUs</h1>
      <ONUTable />
    </div>
  );
}
