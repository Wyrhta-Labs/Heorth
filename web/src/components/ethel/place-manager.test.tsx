/**
 * Component coverage for the place manager.
 *
 * What this pins that nothing else did: the manager is the only place the four
 * place error codes are turned into sentences, and the only place a reparent is
 * constrained client-side. A build that surfaced a raw `PLACE_HAS_CHILDREN` to
 * the member, or that offered a place its own child as a new parent, passed the
 * rest of the suite.
 *
 * The real ToastProvider is mounted rather than mocked, because the assertion
 * that matters is what the member READS — a mocked `toast` would let a raw
 * error code through as long as some string was passed to it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import type { EthelPlace } from '@/lib/types';

const listPlaces = vi.fn();
const createPlace = vi.fn();
const updatePlace = vi.fn();
const deletePlace = vi.fn();

vi.mock('@/api/ethel', () => ({
  listAssets: vi.fn(),
  createAsset: vi.fn(),
  getAsset: vi.fn(),
  updateAsset: vi.fn(),
  decommissionAsset: vi.fn(),
  deleteAsset: vi.fn(),
  listPlaces: (...args: unknown[]) => listPlaces(...args),
  createPlace: (...args: unknown[]) => createPlace(...args),
  updatePlace: (...args: unknown[]) => updatePlace(...args),
  deletePlace: (...args: unknown[]) => deletePlace(...args),
}));

import { ToastProvider } from '@/components/ui/toast';
import PlaceManager from './place-manager';

const HOUSE = '11111111-1111-4111-8111-111111111111';
const GROUND = '22222222-2222-4222-8222-222222222222';
const KITCHEN = '33333333-3333-4333-8333-333333333333';
const SHED = '44444444-4444-4444-8444-444444444444';

const place = (id: string, name: string, parentId: string | null, kind: EthelPlace['kind'] = 'room'): EthelPlace =>
  ({ id, name, kind, parentId, notes: null, createdAt: '', updatedAt: '' });

const TREE: EthelPlace[] = [
  place(HOUSE, 'House', null, 'building'),
  place(GROUND, 'Ground floor', HOUSE, 'floor'),
  place(KITCHEN, 'Kitchen', GROUND),
  place(SHED, 'Shed', null, 'storage'),
];

beforeEach(() => {
  listPlaces.mockResolvedValue({ data: TREE });
  updatePlace.mockResolvedValue({ data: TREE[0] });
  deletePlace.mockResolvedValue({ data: { id: HOUSE } });
  createPlace.mockResolvedValue({ data: TREE[0] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  listPlaces.mockReset();
  createPlace.mockReset();
  updatePlace.mockReset();
  deletePlace.mockReset();
});

async function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PlaceManager open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(nameInput('Kitchen')).toBeInTheDocument());
  return view;
}

/** The parent select rendered for one node, by its stable id. */
function parentPicker(id: string): HTMLSelectElement {
  const el = document.getElementById(`place-parent-${id}`);
  expect(el, `no parent picker for ${id}`).not.toBeNull();
  return el as HTMLSelectElement;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].map((o) => o.textContent!.trim());
}

/** The row whose name INPUT holds `name` - narrowed to inputs because a parent
 *  <select> showing the same place would match the display value too. */
function nameInput(name: string): HTMLInputElement {
  const el = screen.getAllByDisplayValue(name).find((e) => e.tagName === 'INPUT');
  expect(el, `no name input holding ${name}`).toBeDefined();
  return el as HTMLInputElement;
}

function row(name: string): HTMLElement {
  return nameInput(name).closest('li') as HTMLElement;
}

describe('PlaceManager reparenting', () => {
  it('never offers a place itself or anything beneath it as a new parent', async () => {
    await renderManager();

    // House contains Ground floor contains Kitchen. Moving House under any of
    // those three is the client-side half of PLACE_CYCLE: the server answers
    // 400, so the option must not exist at all.
    const houseOptions = optionLabels(parentPicker(HOUSE));
    expect(houseOptions).toContain('No place');
    expect(houseOptions).toContain('Shed');
    expect(houseOptions).not.toContain('House');
    expect(houseOptions).not.toContain('Ground floor');
    expect(houseOptions).not.toContain('Kitchen');

    // Ground floor may move to the root or under House, but not into its own
    // child.
    const groundOptions = optionLabels(parentPicker(GROUND));
    expect(groundOptions).toContain('House');
    expect(groundOptions).not.toContain('Ground floor');
    expect(groundOptions).not.toContain('Kitchen');

    // A leaf excludes only itself.
    expect(optionLabels(parentPicker(KITCHEN))).not.toContain('Kitchen');
    expect(optionLabels(parentPicker(KITCHEN))).toContain('Ground floor');
  });

  it('reparents through PATCH with the moved id and the new parent', async () => {
    await renderManager();
    fireEvent.change(parentPicker(KITCHEN), { target: { value: HOUSE } });
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith(KITCHEN, { parentId: HOUSE }));
  });

  it('sends parentId null when a place is moved to the root', async () => {
    await renderManager();
    fireEvent.change(parentPicker(KITCHEN), { target: { value: '' } });
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith(KITCHEN, { parentId: null }));
  });
});

describe('PlaceManager rename and kind', () => {
  it('renames through PATCH with the row id and the new name only', async () => {
    await renderManager();
    const input = nameInput('Kitchen');
    fireEvent.change(input, { target: { value: 'Scullery' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith(KITCHEN, { name: 'Scullery' }));
  });

  it('does not PATCH when the name is unchanged or blanked', async () => {
    await renderManager();
    const input = nameInput('Kitchen');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(updatePlace).not.toHaveBeenCalled();
  });

  it('changes the kind through PATCH with the row id', async () => {
    await renderManager();
    const kind = row('Kitchen').querySelector('select[aria-label="Kind"]') as HTMLSelectElement;
    expect(kind.value).toBe('room');
    fireEvent.change(kind, { target: { value: 'storage' } });
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith(KITCHEN, { kind: 'storage' }));
  });
});

describe('PlaceManager delete', () => {
  it('warns that assets will be unassigned before deleting', async () => {
    // The whole reason this copy exists: ON DELETE SET NULL is silent, so the
    // member is told here or not at all.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderManager();
    fireEvent.click(row('Kitchen').querySelector('button[aria-label="Delete"]')!);

    await waitFor(() => expect(deletePlace).toHaveBeenCalledWith(KITCHEN));
    const message = confirmSpy.mock.calls[0]![0] as string;
    expect(message).toContain('Kitchen');
    expect(message).toContain('Assets in this place will be unassigned.');
  });

  it('does not delete when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderManager();
    fireEvent.click(row('Kitchen').querySelector('button[aria-label="Delete"]')!);
    expect(deletePlace).not.toHaveBeenCalled();
  });
});

describe('PlaceManager error codes', () => {
  /** Every mapped code must reach the member as a sentence, never as a code. */
  const expectPlainLanguage = async (code: string, sentence: string) => {
    await waitFor(() => expect(screen.getByText(sentence)).toBeInTheDocument());
    expect(screen.queryByText(new RegExp(code))).toBeNull();
  };

  it('renders PLACE_HAS_CHILDREN in plain language', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deletePlace.mockRejectedValue(new ApiError(409, 'PLACE_HAS_CHILDREN', ''));
    await renderManager();
    fireEvent.click(row('House').querySelector('button[aria-label="Delete"]')!);
    await expectPlainLanguage('PLACE_HAS_CHILDREN', 'Move or delete the places inside it first.');
  });

  it('renders PLACE_CYCLE in plain language', async () => {
    updatePlace.mockRejectedValue(new ApiError(400, 'PLACE_CYCLE', ''));
    await renderManager();
    fireEvent.change(parentPicker(KITCHEN), { target: { value: SHED } });
    await expectPlainLanguage('PLACE_CYCLE', 'A place cannot be inside itself.');
  });

  it('renders PLACE_TOO_DEEP in plain language', async () => {
    updatePlace.mockRejectedValue(new ApiError(400, 'PLACE_TOO_DEEP', ''));
    await renderManager();
    fireEvent.change(parentPicker(KITCHEN), { target: { value: SHED } });
    await expectPlainLanguage('PLACE_TOO_DEEP', 'Places may not nest more than 6 deep.');
  });

  it('renders PLACE_NAME_TAKEN in plain language', async () => {
    updatePlace.mockRejectedValue(new ApiError(409, 'PLACE_NAME_TAKEN', ''));
    await renderManager();
    const input = nameInput('Kitchen');
    fireEvent.change(input, { target: { value: 'Shed' } });
    fireEvent.blur(input);
    await expectPlainLanguage('PLACE_NAME_TAKEN', 'A place with that name already exists here.');
  });
});

describe('PlaceManager add', () => {
  it('creates a place with the typed name, the chosen kind and the chosen parent', async () => {
    await renderManager();
    fireEvent.change(screen.getByLabelText('Add place'), { target: { value: 'Pantry' } });
    fireEvent.change(document.getElementById('place-new-parent') as HTMLSelectElement, { target: { value: KITCHEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(createPlace).toHaveBeenCalledWith({ name: 'Pantry', kind: 'room', parentId: KITCHEN }),
    );
  });
});
