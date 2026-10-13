import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Dialog, DialogContent, SCROLL_ROOT_ATTR } from './dialog';

function Page({ open }: { open: boolean }) {
  return (
    <main {...{ [SCROLL_ROOT_ATTR]: '' }} data-testid="main">
      <Dialog open={open} onOpenChange={() => {}}><DialogContent>hi</DialogContent></Dialog>
    </main>
  );
}

function Stacked({ outer, inner }: { outer: boolean; inner: boolean }) {
  return (
    <main {...{ [SCROLL_ROOT_ATTR]: '' }} data-testid="main">
      <Dialog open={outer} onOpenChange={() => {}}><DialogContent>outer</DialogContent></Dialog>
      <Dialog open={inner} onOpenChange={() => {}}><DialogContent>inner</DialogContent></Dialog>
    </main>
  );
}

describe('Dialog scroll lock', () => {
  it('locks body and the shell scroller while open, and releases both', () => {
    const { rerender, getByTestId } = render(<Page open />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(getByTestId('main').style.overflow).toBe('hidden');
    rerender(<Page open={false} />);
    expect(document.body.style.overflow).toBe('');
    expect(getByTestId('main').style.overflow).toBe('');
  });

  it('keeps the lock until the last of two open dialogs closes', () => {
    const { rerender, getByTestId } = render(<Stacked outer inner />);
    rerender(<Stacked outer inner={false} />);
    expect(document.body.style.overflow).toBe('hidden');
    expect(getByTestId('main').style.overflow).toBe('hidden');
    rerender(<Stacked outer={false} inner={false} />);
    expect(document.body.style.overflow).toBe('');
    expect(getByTestId('main').style.overflow).toBe('');
  });

  it('uses the backdrop token', () => {
    render(<Page open />);
    expect(document.querySelector('.bg-backdrop')).not.toBeNull();
  });
});
