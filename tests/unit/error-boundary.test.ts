// Q0268: App's ErrorBoundary "Try again" (unreachable by the walker without a render crash).
// A child throws once; the boundary shows the problem card with the error message; Try again
// clears the error and the child renders again.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/renderer/src/components/ErrorBoundary';

function findButton(node: ReactNode): ReactElement<{ onClick: () => void; children: ReactNode }> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>;
  if (el.type === 'button') return el as ReactElement<{ onClick: () => void; children: ReactNode }>;
  const kids = ([] as ReactNode[]).concat(el.props.children ?? []);
  for (const k of kids) { const b = findButton(k); if (b) return b; }
  return null;
}

describe('ErrorBoundary Try again', () => {
  it('shows the problem card, then Try again renders the child again', () => {
    let throwOnce = true;
    const Child = (): ReactElement => {
      if (throwOnce) throw new Error('nodes list exploded');
      return createElement('p', null, 'child ok');
    };
    const child = createElement(Child);
    const b = new ErrorBoundary({ children: child });
    // React calls this when the child throws during render.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderToStaticMarkup(child)).toThrow('nodes list exploded');
    b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError(new Error('nodes list exploded')) };

    const card = b.render();
    const html = renderToStaticMarkup(card as ReactElement);
    expect(html).toContain('This screen hit a problem.');
    expect(html).toContain('nodes list exploded');

    const retry = findButton(card);
    expect(retry?.props.children).toBe('Try again');
    b.setState = ((s: { error: Error | null }) => { b.state = { ...b.state, ...s }; }) as typeof b.setState;
    throwOnce = false;
    retry!.props.onClick();

    expect(b.state.error).toBeNull();
    expect(renderToStaticMarkup(b.render() as ReactElement)).toBe('<p>child ok</p>');
  });
});
