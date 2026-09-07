'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch as fetch } from '../../client/api.mjs';
import { ReviewedSaveRequestForm } from './check-consequences';

type ReviewOptions = { gameRevision: number; phase: string; canRequest: boolean; actors: { id: string; name: string }[] };
type Props = {
  campaign: string;
  gameRevision: number;
  /** Fetch and apply the current game view; reject if it could not be refreshed. */
  onRefreshGame: () => Promise<void>;
  onRequested?: () => void | Promise<void>;
};
function validOptions(value: unknown): value is ReviewOptions {
  if (!value || typeof value !== 'object') return false;
  const options = value as ReviewOptions;
  return Number.isSafeInteger(options.gameRevision) && options.gameRevision >= 1
    && ['combat', 'exploration', 'paused', 'complete'].includes(options.phase)
    && typeof options.canRequest === 'boolean' && Array.isArray(options.actors)
    && options.actors.every(actor => actor && typeof actor.id === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(actor.id)
      && typeof actor.name === 'string' && actor.name.length > 0);
}

/** Mount with a campaign key: options and pending drafts belong to one authenticated game. */
export function CheckRequestPanel(props: Props) {
  return <ScopedCheckRequestPanel key={props.campaign} {...props} />;
}
function ScopedCheckRequestPanel({ campaign, gameRevision, onRefreshGame, onRequested }: Props) {
  const [options, setOptions] = useState<ReviewOptions | null>(null);
  const [denied, setDenied] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState('');
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  const manualRefresh = useRef(false), mounted = useRef(false), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const refreshOptions = useCallback(async () => {
    if (!mounted.current) throw new Error('The review controls have closed.');
    const current = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setRefreshing(true); setError('');
    try {
      const response = await fetch('/api/game/checks/request', { cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      if (!mounted.current || current !== sequence.current) throw new Error('This refresh was superseded.');
      if (response.status === 401 || response.status === 403) {
        setDenied(true); setOptions(null);
        throw new Error('Host review is not available to this session.');
      }
      const body = await response.json() as { options?: unknown; error?: string };
      if (!mounted.current || current !== sequence.current) throw new Error('This refresh was superseded.');
      if (!response.ok || !validOptions(body.options)) throw new Error(body.error ?? 'Check review options could not be refreshed.');
      setOptions(body.options); setDenied(false);
    } catch (reason) {
      if (mounted.current && current === sequence.current) setError(reason instanceof Error ? reason.message : 'Check review options could not be refreshed.');
      throw reason;
    } finally { if (mounted.current && current === sequence.current) setRefreshing(false); }
  }, []);
  useEffect(() => { if (!manualRefresh.current) void refreshOptions().catch(() => {}); }, [gameRevision, refreshOptions]);

  async function refreshForReview() {
    // Do not let the resulting parent revision refresh cancel this explicit review operation.
    if (manualRefresh.current) throw new Error('A review refresh is already in progress.');
    manualRefresh.current = true; setReviewRefreshing(true);
    try { await onRefreshGame(); await refreshOptions(); }
    finally { manualRefresh.current = false; if (mounted.current) setReviewRefreshing(false); }
  }
  function retryReviewRefresh() {
    void refreshForReview().catch(() => { if (mounted.current) setError('The current map could not be refreshed. Retry before reviewing a new save.'); });
  }
  if (denied) return null;
  if (!options) return error ? <p role="status" className="mt-4 text-sm">Save review controls are unavailable. <button type="button" disabled={refreshing} onClick={() => void refreshOptions().catch(() => {})} className="underline">Retry</button></p> : null;
  const current = options.gameRevision === gameRevision;
  return <details className="mt-4 rounded border border-amber-200/30 p-4" data-campaign={campaign}>
    <summary className="cursor-pointer font-semibold">Host: request a saving throw with damage</summary>
    {error && <p role="status" className="mt-2 text-sm text-amber-100">{error} <button type="button" disabled={refreshing || reviewRefreshing} onClick={retryReviewRefresh} className="underline">Refresh</button></p>}
    {!current && <p className="mt-2 text-sm">Refresh the current map state before a new review. <button type="button" disabled={refreshing || reviewRefreshing} onClick={retryReviewRefresh} className="underline">Refresh map and controls</button></p>}
    {!options.canRequest && <p className="mt-2 text-sm">{options.phase === 'complete' ? 'This encounter is complete.' : 'Resolve the pending reaction or concentration save before preparing another save.'}</p>}
    {!options.actors.length && <p className="mt-2 text-sm">There are no living player characters with a matching approved sheet in this scene. Confirm the character approvals before requesting damage.</p>}
    <fieldset disabled={refreshing || reviewRefreshing || !!error || !current || !options.canRequest}>
      <ReviewedSaveRequestForm authorizedHost gameRevision={options.gameRevision} actors={options.actors} onRefresh={refreshForReview}
        onRequested={async () => { await refreshForReview(); if (onRequested) await onRequested(); }} />
    </fieldset>
  </details>;
}
