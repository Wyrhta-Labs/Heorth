import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OfflineBanner from './offline-banner';

describe('OfflineBanner', () => {
  it('renders nothing when online and nothing queued', () => {
    const { container } = render(<OfflineBanner isOffline={false} dataAsOf={null} pendingCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an offline indicator with the cached data time', () => {
    render(<OfflineBanner isOffline dataAsOf="2026-07-23T17:40:00.000Z" pendingCount={0} />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
  });

  it('shows a syncing message once back online with items still queued', () => {
    render(<OfflineBanner isOffline={false} dataAsOf={null} pendingCount={2} />);
    expect(screen.getByText(/Syncing 2 check-offs/)).toBeInTheDocument();
  });

  it('shows the queued count alongside the offline indicator', () => {
    render(<OfflineBanner isOffline dataAsOf={null} pendingCount={3} />);
    expect(screen.getByText('3 queued')).toBeInTheDocument();
  });
});
