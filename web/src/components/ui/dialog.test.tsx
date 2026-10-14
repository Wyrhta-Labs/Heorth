import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, SCROLL_ROOT_ATTR } from './dialog';

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

function WithTrigger({ autoFocusSecond = false }: { autoFocusSecond?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <button>behind</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <button>first</button>
          <input aria-label="second" autoFocus={autoFocusSecond} />
          <button>last</button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Dialog focus management', () => {
  it('moves focus to the first focusable element on open', async () => {
    const user = userEvent.setup();
    render(<WithTrigger />);
    await user.click(screen.getByText('open'));
    expect(screen.getByText('first')).toHaveFocus();
  });

  it('respects an autoFocused child', async () => {
    const user = userEvent.setup();
    render(<WithTrigger autoFocusSecond />);
    await user.click(screen.getByText('open'));
    expect(screen.getByLabelText('second')).toHaveFocus();
  });

  it('focuses the panel when nothing inside is focusable', () => {
    render(<Dialog open onOpenChange={() => {}}><DialogContent>plain</DialogContent></Dialog>);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('wraps Tab from last to first and Shift+Tab from first to last', async () => {
    const user = userEvent.setup();
    render(<WithTrigger />);
    await user.click(screen.getByText('open'));
    screen.getByText('last').focus();
    await user.tab();
    expect(screen.getByText('first')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByText('last')).toHaveFocus();
  });

  it('does not steal focus on re-render while open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dialog open onOpenChange={() => {}}><DialogContent><button>a</button><button>b</button></DialogContent></Dialog>);
    screen.getByText('b').focus();
    rerender(<Dialog open onOpenChange={() => {}}><DialogContent><button>a</button><button>b</button></DialogContent></Dialog>);
    expect(screen.getByText('b')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByText('a')).toHaveFocus();
  });

  it('restores focus to the opener on close', async () => {
    const user = userEvent.setup();
    render(<WithTrigger />);
    await user.click(screen.getByText('open'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('open')).toHaveFocus();
  });

  it('traps only in the topmost of stacked dialogs and restores into the lower one', async () => {
    const user = userEvent.setup();
    function Two() {
      const [inner, setInner] = useState(false);
      return (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <button onClick={() => setInner(true)}>open inner</button>
            <Dialog open={inner} onOpenChange={setInner}>
              <DialogContent><button>i1</button><button>i2</button></DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Two />);
    await user.click(screen.getByText('open inner'));
    expect(screen.getByText('i1')).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByText('i1')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByText('open inner')).toHaveFocus();
  });
});

describe('Dialog labelling', () => {
  it('links the panel to its title and description', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent><DialogTitle>Hello</DialogTitle><DialogDescription>Details</DialogDescription></DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Hello' })).toHaveAccessibleDescription('Details');
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(screen.getByText('Hello').id);
  });

  it('omits aria-labelledby/describedby without a title or description', () => {
    render(<Dialog open onOpenChange={() => {}}><DialogContent>x</DialogContent></Dialog>);
    const d = screen.getByRole('dialog');
    expect(d).not.toHaveAttribute('aria-labelledby');
    expect(d).not.toHaveAttribute('aria-describedby');
  });

  it('references a caller-provided id on title and description', () => {
    render(
      <Dialog open onOpenChange={() => {}}>
        <DialogContent><DialogTitle id="custom-title">Hello</DialogTitle><DialogDescription id="custom-desc">Details</DialogDescription></DialogContent>
      </Dialog>,
    );
    const d = screen.getByRole('dialog');
    expect(d).toHaveAttribute('aria-labelledby', 'custom-title');
    expect(d).toHaveAttribute('aria-describedby', 'custom-desc');
    expect(document.getElementById('custom-title')).not.toBeNull();
    expect(d).toHaveAccessibleName('Hello');
  });

  it('follows a changing id and drops the reference when the title unmounts', () => {
    const ui = (id: string | null) => (
      <Dialog open onOpenChange={() => {}}>
        <DialogContent>{id && <DialogTitle id={id}>Hello</DialogTitle>}<button>x</button></DialogContent>
      </Dialog>
    );
    const { rerender } = render(ui('a'));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'a');
    rerender(ui('b'));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'b');
    rerender(ui(null));
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
  });
});
