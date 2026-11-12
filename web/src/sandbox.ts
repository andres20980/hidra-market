// sandbox.ts v1.1 — badge "validado en near-sandbox" from sandbox_round.json
export interface SandboxRound { network: string; market: string; winner: string; state: string }

export function sandboxBadge(r: unknown): string {
  const s = r as Partial<SandboxRound> | null;
  if (!s || s.network !== 'near-sandbox' || (s.state !== 'Settled' && s.state !== 'Closed') || !s.winner) return '';
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<span class="status" id="sandbox-badge" title="${esc(String(s.market))}">✓ ${s.state === 'Settled' ? 'settled' : 'closed'} on near-sandbox · winner ${esc(s.winner)}</span>`;
}

export async function loadSandboxBadge(f: typeof fetch = fetch): Promise<string> {
  try {
    const res = await f('sandbox_round.json');
    return res.ok ? sandboxBadge(await res.json()) : '';
  } catch { return ''; }
}
