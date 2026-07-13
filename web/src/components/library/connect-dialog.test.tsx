import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const createLTMutateAsync = vi.fn();

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/hooks/use-library', () => ({
  useCreateLibraryThing: () => ({ mutateAsync: createLTMutateAsync, isPending: false }),
  useStartTraktDevice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePollTraktDevice: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import ConnectDialog from './connect-dialog';

describe('ConnectDialog', () => {
  beforeEach(() => {
    toast.mockClear();
    createLTMutateAsync.mockReset();
  });

  it('surfaces an error toast when the LibraryThing connect fails', async () => {
    createLTMutateAsync.mockRejectedValue(new Error('boom'));
    render(<ConnectDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('LibraryThing'));
    fireEvent.change(screen.getByPlaceholderText('LibraryThing user id'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByPlaceholderText('API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByText('Connect LibraryThing'));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('boom', 'error'));
  });
});
