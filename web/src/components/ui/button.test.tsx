import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

const cases = [
  ['default', 'bg-primary'],
  ['outline', 'border-line-strong'],
  ['secondary', 'bg-surface-3'],
  ['ghost', 'text-muted'],
  ['destructive', 'bg-danger-bg'],
  ['warning', 'bg-warning-bg'],
  ['success', 'bg-success'],
  ['link', 'text-primary'],
] as const;

describe('Button', () => {
  it.each(cases)('%s variant uses its token classes', (variant, cls) => {
    render(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole('button', { name: variant })).toHaveClass(cls);
  });

  it('has the mockup shape: control radius, 1.5px border, weight 600', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('rounded-control', 'border-[1.5px]', 'font-semibold');
  });
});
