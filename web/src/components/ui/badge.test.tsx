import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

const cases = [
  ['default', 'bg-primary-light'],
  ['secondary', 'bg-surface-3'],
  ['outline', 'bg-surface-2'],
  ['success', 'bg-success-bg'],
  ['warning', 'bg-warning-bg'],
  ['destructive', 'bg-danger-bg'],
  ['info', 'bg-info-bg'],
  ['accent', 'bg-accent-bg'],
] as const;

describe('Badge', () => {
  it.each(cases)('%s variant uses its token classes', (variant, cls) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toHaveClass(cls, 'rounded-full');
  });
});
