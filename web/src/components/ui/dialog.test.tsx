import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogClose, DialogContent, SCROLL_ROOT_ATTR } from './dialog';

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

describe('Dialog accessibility', () => {
  it('exposes a modal dialog role', () => {
    render(<Dialog open onOpenChange={() => {}}><DialogContent>hi</DialogContent></Dialog>);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange}><DialogContent>hi</DialogContent></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes only the topmost of two stacked dialogs on Escape', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onOpenChange={outer}><DialogContent>outer</DialogContent></Dialog>
        <Dialog open onOpenChange={inner}><DialogContent>inner</DialogContent></Dialog>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledWith(false);
    expect(outer).not.toHaveBeenCalled();
  });

  it('stops listening once closed', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Dialog open onOpenChange={onOpenChange}><DialogContent>hi</DialogContent></Dialog>);
    rerender(<Dialog open={false} onOpenChange={onOpenChange}><DialogContent>hi</DialogContent></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('gives the close button an accessible name', () => {
    render(<DialogClose />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
