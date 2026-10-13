import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { SectionCard } from './section-tone';

describe('SectionCard', () => {
  it('renders the icon in a 24px tinted square in the tone colour', () => {
    render(<SectionCard title="Bills" icon={Wallet} tone="amber">x</SectionCard>);
    const square = screen.getByText('Bills').parentElement!.querySelector('[data-slot="section-icon"]')!;
    expect(square).toHaveClass('size-6', 'rounded-md', 'bg-warning-bg', 'text-warning');
  });

  it('header is a strip with a bottom border', () => {
    render(<SectionCard title="Bills" icon={Wallet} tone="ember">x</SectionCard>);
    const header = screen.getByText('Bills').closest('[data-slot="card-header"]')!;
    expect(header).toHaveClass('border-b');
  });
});
