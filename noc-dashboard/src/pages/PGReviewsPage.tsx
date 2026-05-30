import { useEffect, useState } from 'react';
import { applyPGReview, dismissPGReview, fetchPGReviews } from '../api/noc';
import type { PGReviewEvent } from '../types/noc';

const FIELDS = ['username', 'mac_address', 'ont_serial', 'ont_sticker_photo_url'];

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function ReviewRow({ review, onDone }: { review: PGReviewEvent; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const current = review.after_data?.current ?? review.before_data ?? {};
  const proposed = review.after_data?.proposed ?? {};

  async function act(kind: 'apply' | 'dismiss') {
    const defaultReason = kind === 'apply' ? 'verified field evidence' : 'kept current room identity';
    const reason = window.prompt(`${kind === 'apply' ? 'Apply' : 'Dismiss'} reason`, defaultReason);
    if (!reason) return;
    setBusy(true);
    try {
      if (kind === 'apply') {
        await applyPGReview(review.entity_id, review.id, reason);
      } else {
        await dismissPGReview(review.entity_id, review.id, reason);
      }
      onDone();
    } catch (error: any) {
      alert(error?.response?.data?.detail ?? 'Review action failed');
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-slate-700/30 hover:bg-slate-700/20">
      <td className="px-4 py-3 align-top">
        <div className="font-mono text-slate-200">{review.entity_id}</div>
        <div className="text-xs text-slate-500 mt-1">{review.building_id ?? '-'} / {review.changed_by ?? 'unknown'}</div>
        <div className="text-xs text-slate-500">{formatDate(review.created_at)}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="space-y-2">
          {FIELDS.map(field => (
            <div key={field} className="grid grid-cols-[120px_1fr_1fr] gap-3 text-xs">
              <div className="text-slate-500">{field}</div>
              <div className="font-mono text-slate-300 truncate" title={valueText(current[field])}>{valueText(current[field])}</div>
              <div className="font-mono text-blue-300 truncate" title={valueText(proposed[field])}>{valueText(proposed[field])}</div>
            </div>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 align-top text-sm text-slate-300 max-w-xs">
        {review.reason ?? 'Review required'}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => act('apply')}
            className="px-3 py-1.5 rounded bg-blue-600/25 hover:bg-blue-600/40 border border-blue-500/30 text-blue-200 text-xs disabled:opacity-50"
          >
            Apply
          </button>
          <button
            disabled={busy}
            onClick={() => act('dismiss')}
            className="px-3 py-1.5 rounded bg-slate-700/70 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function PGReviewsPage() {
  const [reviews, setReviews] = useState<PGReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setReviews(await fetchPGReviews());
    } catch {
      setError('Could not load PG review queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">PG Review Queue</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Offline room identity changes that need operator approval before changing customer or ONU truth.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div>}
      {loading && <div className="text-center py-12 text-slate-500">Loading...</div>}

      {!loading && reviews.length === 0 && (
        <div className="rounded-lg border border-green-500/30 bg-green-950/20 p-6 text-center">
          <div className="text-green-300 font-medium">No PG reviews pending</div>
          <div className="text-slate-500 text-sm mt-1">Offline PG changes are aligned with server truth.</div>
        </div>
      )}

      {!loading && reviews.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50 text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-left">Current / Proposed</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map(review => (
                <ReviewRow key={review.id} review={review} onDone={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
