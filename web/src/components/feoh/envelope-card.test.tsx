import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EnvelopeCard from './envelope-card';
import type { EnvelopeSummary } from '@/lib/types';

const env = (over: Partial<EnvelopeSummary>): EnvelopeSummary => ({
  envelopeId: 'e1', name: 'Groceries', tone: 'sage', budget: 400, spent: 120, remaining: 280, ...over,
});

describe('EnvelopeCard', () => {
  it('shows spent/budget and remaining for an under-budget envelope', () => {
    render(<EnvelopeCard envelope={env({})} />);
    expect(screen.getByText('$120.00 / $400.00')).toBeInTheDocument();
    expect(screen.getByText('$280.00 left')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
  });

  it('shows the over-budget amount when spent exceeds budget', () => {
    render(<EnvelopeCard envelope={env({ spent: 450, remaining: -50 })} />);
    expect(screen.getByText('$50.00 over')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
