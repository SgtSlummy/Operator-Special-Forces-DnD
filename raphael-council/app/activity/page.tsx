'use client';
import { apiFetch as fetch } from '../../client/api.mjs';
import { useEffect, useState } from 'react';
import Play from '../play/page';

export default function Activity() {
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function start() {
      const configuration = await fetch('/api/auth/config', { cache: 'no-store' }).then(r => r.json()) as { clientId: string | null };
      if (!configuration.clientId) throw new Error('The host must configure the Davy Jones application ID.');
      const { DiscordSDK } = await import('@discord/embedded-app-sdk');
      const sdk = new DiscordSDK(configuration.clientId);
      await sdk.ready();
      const { code } = await sdk.commands.authorize({ client_id: configuration.clientId, response_type: 'code', state: crypto.randomUUID(), prompt: 'none', scope: ['identify'] });
      if (!active) return;
      const response = await fetch('/api/auth/activity', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const body = await response.json() as { error?: string; access_token: string };
      if (!response.ok) throw new Error(body.error || 'Discord authorization failed.');
      await sdk.commands.authenticate({ access_token: body.access_token });
      if (active) setReady(true);
    }
    void start().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Activity could not connect.'); });
    return () => { active = false; };
  }, []);
  if (ready) return <Play embedded />;
  return <main className="min-h-screen bg-[#0b0a13] p-8 text-amber-50"><h1 className="font-serif text-3xl">Davy Jones · Raphael</h1><p role="status" className="my-4">{error || 'Connecting your Discord identity to the shared game…'}</p>{error && <button onClick={() => location.reload()}>Retry connection</button>}</main>;
}
