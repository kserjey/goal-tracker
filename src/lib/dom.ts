/** DOM helpers. Rendering stays innerHTML string-building as in the prototype —
 *  it is fast and already correct. The rule that makes that safe: every
 *  user-supplied string passes through esc(). */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

const ENT: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENT[c]!);

/** 12-char URL-safe random id. Sequential ("g0") or timestamp ids collide when
 *  two devices merge; 12 random chars keep mark keys compact vs a full UUID. */
const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  let s = '';
  for (const n of b) s += ALPHA[n % ALPHA.length];
  return s;
}
