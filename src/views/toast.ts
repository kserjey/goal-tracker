import { $ } from '../lib/dom.ts';

let timer: ReturnType<typeof setTimeout> | undefined;

/** Transient status line; with `label` it becomes an undo affordance. */
export function toast(msg: string, label?: string, fn?: () => void): void {
  const el = $('#toast');
  el.textContent = '';
  const sp = document.createElement('span');
  sp.textContent = msg;
  el.append(sp);
  if (label && fn) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { el.classList.remove('show'); fn(); };
    el.append(b);
  }
  el.classList.toggle('act', !!label);
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), label ? 5000 : 1800);
}
