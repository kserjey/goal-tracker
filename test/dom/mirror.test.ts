// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { MIRROR_KEY, newerOf, readMirror, writeMirror } from '../../src/storage/mirror.ts';

beforeEach(() => localStorage.clear());

describe('crash-safety mirror', () => {
  it('round-trips state synchronously', () => {
    writeMirror({ v: 1, goals: [{ id: 'a' }] }, 500);
    expect(readMirror()).toEqual({ savedAt: 500, state: { v: 1, goals: [{ id: 'a' }] } });
  });

  it('returns null when nothing is stored', () => {
    expect(readMirror()).toBeNull();
  });

  it('survives a corrupt mirror without throwing', () => {
    localStorage.setItem(MIRROR_KEY, 'not json');
    expect(readMirror()).toBeNull();
  });

  it('treats a record with no savedAt as oldest', () => {
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ state: { v: 1 } }));
    expect(readMirror()?.savedAt).toBe(0);
  });

  it('does not throw when localStorage rejects writes (private mode)', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('QuotaExceeded'); };
    expect(() => writeMirror({ v: 1 })).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});

describe('newerOf', () => {
  const a = { savedAt: 100, state: 'a' };
  const b = { savedAt: 200, state: 'b' };

  it('prefers the newer copy in both argument orders', () => {
    expect(newerOf(a, b)).toBe(b);
    expect(newerOf(b, a)).toBe(b);
  });
  it('falls back to whichever exists', () => {
    expect(newerOf(null, a)).toBe(a);
    expect(newerOf(a, null)).toBe(a);
    expect(newerOf(null, null)).toBeNull();
  });
  it('prefers the primary store on an exact tie', () => {
    const p = { savedAt: 100, state: 'primary' };
    expect(newerOf(p, { savedAt: 100, state: 'mirror' })).toBe(p);
  });
});
