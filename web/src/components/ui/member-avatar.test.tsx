// web/src/components/ui/member-avatar.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberAvatar, initials } from './member-avatar';
import { MEMBER_COLORS } from '@/lib/constants';

describe('initials', () => {
  it('derives initials from one or two names', () => {
    expect(initials('Mara')).toBe('MA');
    expect(initials('Ælric Stone')).toBe('ÆS');
    expect(initials('')).toBe('?');
  });
});

describe('MemberAvatar', () => {
  it('renders initials with the palette background color', () => {
    render(<MemberAvatar name="Ines Vega" color="sage" />);
    const el = screen.getByText('IV');
    expect(el).toBeInTheDocument();
    expect(el).toHaveStyle({ backgroundColor: MEMBER_COLORS.sage });
  });
});
