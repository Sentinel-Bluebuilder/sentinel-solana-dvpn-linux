// ─── trJsx(): one whole sentence with marked-up parts (docs/i18n/RULES-CODE.md) ───
// A sentence with a link, a term or bold words inside stays one sentence for the translator:
//   trJsx('Open <link>Settings</link> to change it.', { link: (t) => <a onClick={…}>{t}</a> })
//   trJsx('Run <cmd/> in a terminal.', { cmd: () => <code>devnet-dvpn daemon install --yes</code> })
// The words between the tags are translated with the sentence; the tags may move. Values go in
// as {name} placeholders through `vars`, as with tr().
import { Fragment, type ReactNode } from 'react';
import { tr, type Vars } from '../../../shared/i18n';

export type Part = (inner: string) => ReactNode;

const TAG = /<(\w+)\/>|<(\w+)>([\s\S]*?)<\/\2>/g;
// The callers' trJsx('…') literals are what the extract script reads; this inner lookup is not a sentence.
const lookup = tr;

export function trJsx(text: string, parts: Record<string, Part>, vars?: Vars, context?: string): ReactNode {
  const s = lookup(text, vars, context);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of s.matchAll(TAG)) {
    const name = m[1] ?? m[2];
    const draw = parts[name];
    if (m.index! > last) out.push(s.slice(last, m.index));
    out.push(<Fragment key={i++}>{draw ? draw(m[3] ?? '') : m[3] ?? ''}</Fragment>);
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <>{out}</>;
}
