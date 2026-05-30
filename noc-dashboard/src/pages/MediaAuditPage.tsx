import { useEffect, useMemo, useState } from 'react';
import { fetchMediaAudit } from '../api/noc';
import type { DuplicateMediaReference, MediaAuditData, MediaOwnerRef, MissingMediaFile, OrphanMediaFile } from '../types/noc';

function bytesLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatModified(value: number) {
  if (!value) return '-';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function OwnerList({ owners }: { owners: MediaOwnerRef[] }) {
  if (owners.length === 0) return <span className="text-slate-500">No owner</span>;
  return (
    <div className="space-y-1">
      {owners.map((owner, index) => (
        <div key={`${owner.owner_type}-${owner.owner_id}-${owner.field}-${index}`} className="text-xs text-slate-300">
          <span className="text-slate-100">{owner.owner_type}</span>
          <span className="text-slate-500"> / </span>
          <span className="font-mono">{owner.owner_id}</span>
          <span className="text-slate-500"> / </span>
          <span>{owner.field}</span>
        </div>
      ))}
    </div>
  );
}

function MissingTable({ rows }: { rows: MissingMediaFile[] }) {
  if (rows.length === 0) {
    return <EmptyState text="No missing referenced files. Database references match files on disk." tone="green" />;
  }
  return (
    <div className="rounded-lg border border-red-500/25 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-red-500/20 font-semibold text-red-200">Missing Referenced Files</div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="px-4 py-3 text-left">URL</th>
            <th className="px-4 py-3 text-left">Expected Path</th>
            <th className="px-4 py-3 text-left">Owners</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.url} className="border-b border-slate-800/70">
              <td className="px-4 py-3 align-top font-mono text-red-200 break-all">{row.url}</td>
              <td className="px-4 py-3 align-top font-mono text-slate-400 break-all">{row.expected_path}</td>
              <td className="px-4 py-3 align-top"><OwnerList owners={row.owners} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateTable({ rows }: { rows: DuplicateMediaReference[] }) {
  if (rows.length === 0) {
    return <EmptyState text="No duplicate references found." tone="green" />;
  }
  return (
    <div className="rounded-lg border border-yellow-500/25 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-yellow-500/20 font-semibold text-yellow-200">Duplicate References</div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="px-4 py-3 text-left">URL</th>
            <th className="px-4 py-3 text-left">Owners</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.url} className="border-b border-slate-800/70">
              <td className="px-4 py-3 align-top font-mono text-yellow-100 break-all">{row.url}</td>
              <td className="px-4 py-3 align-top"><OwnerList owners={row.owners} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrphanTable({ rows }: { rows: OrphanMediaFile[] }) {
  if (rows.length === 0) {
    return <EmptyState text="No orphan files found for this scan." tone="green" />;
  }
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700/60 font-semibold text-slate-100">Orphan Files On Disk</div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="px-4 py-3 text-left">File</th>
            <th className="px-4 py-3 text-left">Size</th>
            <th className="px-4 py-3 text-left">Modified</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.url} className="border-b border-slate-800/70">
              <td className="px-4 py-3 align-top">
                <div className="font-mono text-slate-200 break-all">{row.url}</div>
                <div className="mt-1 font-mono text-xs text-slate-500 break-all">{row.relative_path}</div>
              </td>
              <td className="px-4 py-3 align-top text-slate-300">{bytesLabel(row.size_bytes)}</td>
              <td className="px-4 py-3 align-top text-slate-400">{formatModified(row.modified_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text, tone }: { text: string; tone?: 'green' }) {
  const color = tone === 'green'
    ? 'border-green-500/30 bg-green-950/20 text-green-300'
    : 'border-slate-700/60 bg-slate-900/40 text-slate-400';
  return (
    <div className={`rounded-lg border px-4 py-5 text-sm ${color}`}>
      {text}
    </div>
  );
}

export default function MediaAuditPage() {
  const [data, setData] = useState<MediaAuditData | null>(null);
  const [includeOrphans, setIncludeOrphans] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await fetchMediaAudit(includeOrphans, 500));
    } catch {
      setError('Could not load media audit');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [includeOrphans]);

  const status = useMemo(() => {
    if (!data) return { label: 'Unknown', tone: 'text-slate-100' };
    if (data.summary.missing_files > 0) return { label: 'Action Required', tone: 'text-red-300' };
    if (data.summary.orphan_files > 0 || data.summary.duplicate_references > 0) return { label: 'Review Needed', tone: 'text-yellow-300' };
    return { label: 'Clean', tone: 'text-green-300' };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Media Audit</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Upload ownership, missing referenced files, duplicate references, and orphan files.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={includeOrphans}
              onChange={e => setIncludeOrphans(e.target.checked)}
              className="accent-blue-500"
            />
            Include orphan scan
          </label>
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && <div className="text-center py-12 text-slate-500">Loading...</div>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
            <StatTile label="Status" value={status.label} tone={status.tone} />
            <StatTile label="Referenced" value={data.summary.referenced_urls} />
            <StatTile label="Disk Files" value={data.summary.disk_files} />
            <StatTile label="Missing" value={data.summary.missing_files} tone={data.summary.missing_files ? 'text-red-300' : 'text-green-300'} />
            <StatTile label="Orphans" value={data.summary.orphan_files} tone={data.summary.orphan_files ? 'text-yellow-300' : 'text-green-300'} />
            <StatTile label="Duplicates" value={data.summary.duplicate_references} tone={data.summary.duplicate_references ? 'text-yellow-300' : 'text-green-300'} />
            <StatTile label="Orphan Size" value={bytesLabel(data.summary.orphan_size_bytes)} />
          </div>

          <section className="rounded-lg border border-blue-500/30 bg-blue-950/20 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-blue-300">Operator Action</div>
            <div className="mt-1 text-sm text-slate-200">
              Restore missing referenced files from the latest backup before changing database rows. Review orphan files before deletion; this page is read-only.
            </div>
            <div className="mt-2 text-xs font-mono text-slate-400 break-all">Upload root: {data.upload_root}</div>
          </section>

          <MissingTable rows={data.missing_files} />
          <DuplicateTable rows={data.duplicate_references} />
          {includeOrphans && <OrphanTable rows={data.orphan_files} />}
        </>
      )}
    </div>
  );
}
