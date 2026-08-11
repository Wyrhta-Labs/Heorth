import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from '@/i18n';
import HearthWeek from './hearth-week';
import type { DayComposition } from '@/lib/hearth';
import type { EventOccurrence, MealPlanEntry, Recipe } from '@/lib/types';

afterEach(cleanup);

// jsdom has no elementFromPoint; provide one whose hit-test can be pointed at a day.
function hitTest(targetIso: string) {
  (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => ({
    closest: () => ({ getAttribute: () => targetIso }),
  }) as unknown as Element;
}

function supper(date: string, freeText: string): MealPlanEntry {
  return { id: `m-${date}`, createdAt: '', updatedAt: '', date, slot: 'supper', recipeId: null, freeText, cook: null, helper: null };
}
function day(iso: string, sup: MealPlanEntry | null, events: EventOccurrence[] = []): DayComposition {
  return { iso, events, supper: sup, tasks: { open: [], completed: [], hiddenCompleted: 0 } };
}
function occurrence(overrides: Partial<EventOccurrence>): EventOccurrence {
  return {
    id: 'e1', createdAt: '', updatedAt: '', title: 'Event', startAt: '2026-07-20T08:00:00',
    endAt: '2026-07-20T09:00:00', allDay: false, location: null, notes: null, category: null,
    color: null, createdBy: 'nobody', recurrence: null, attendeeIds: [],
    occurrenceStart: '2026-07-20T08:00:00',
    ...overrides,
  };
}

const days: DayComposition[] = [
  day('2026-07-20', supper('2026-07-20', 'Pie')),
  day('2026-07-21', supper('2026-07-21', 'Soup')),
];

const base = {
  todayIso: '2026-07-20',
  membersById: {},
  recipesById: {} as Record<string, Recipe>,
  staleByOwner: {},
  completingIds: new Set<string>(),
  onCompleteTask: vi.fn(),
  onOpenRecipe: vi.fn(),
};

describe('HearthWeek all-day events', () => {
  it('renders an all-day event as a tinted banner with the all-day badge and no time gutter', () => {
    const allDay = occurrence({ id: 'ad', title: 'School holidays', allDay: true, occurrenceStart: '2026-07-20T00:00:00' });
    const { container } = render(
      <HearthWeek {...base} days={[day('2026-07-20', null, [allDay])]} onSwapMeal={vi.fn()} />,
    );

    const banner = container.querySelector('[data-allday]');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('School holidays');
    // Distinct treatment: a subtle fill tinted from the attribution colour
    // (unattributed fallback #b5542f + 15% alpha) instead of the card ground.
    expect((banner as HTMLElement).style.backgroundColor).not.toBe('');
    // The textual marker survives as a compact badge, not a cramped time-gutter word.
    expect(screen.getByText('All day')).toBeInTheDocument();
    // No time gutter: the fixed-min-width time span only exists on timed chips.
    expect(banner!.querySelector('span[style*="min-width"]')).toBeNull();
  });

  it('keeps timed events on the plain time + title chip', () => {
    const timed = occurrence({ id: 'tm', title: 'Dentist' });
    const { container } = render(
      <HearthWeek {...base} days={[day('2026-07-20', null, [timed])]} onSwapMeal={vi.fn()} />,
    );

    expect(screen.getByText('Dentist')).toBeInTheDocument();
    expect(container.querySelector('[data-allday]')).toBeNull();
    expect(screen.queryByText('All day')).toBeNull();
    // Timed chips keep the time gutter.
    expect(container.querySelector('span[style*="min-width"]')).toBeInTheDocument();
  });

  it('shows the German badge "Ganztägig" in full on the banner', async () => {
    await i18n.changeLanguage('de');
    const allDay = occurrence({ id: 'ad', title: 'Ferien', allDay: true, occurrenceStart: '2026-07-20T00:00:00' });
    render(<HearthWeek {...base} days={[day('2026-07-20', null, [allDay])]} onSwapMeal={vi.fn()} />);
    expect(screen.getByText('Ganztägig')).toBeInTheDocument();
  });
});

describe('HearthWeek meal drag', () => {
  it('calls onSwapMeal with the source and drop-target days on a pointer drag', () => {
    const onSwapMeal = vi.fn();
    render(<HearthWeek {...base} days={days} onSwapMeal={onSwapMeal} />);

    // Drag the first day's supper onto the second day.
    const grips = screen.getAllByLabelText('Move meal');
    // Point the hit-test at the target day for the duration of the drag.
    hitTest('2026-07-21');

    fireEvent.pointerDown(grips[0]!, { clientX: 10, clientY: 10 });
    fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: 10 }));
    fireEvent(window, new MouseEvent('pointerup', {}));

    expect(onSwapMeal).toHaveBeenCalledWith('2026-07-20', '2026-07-21');
  });

  it('does not swap when dropped on the same day', () => {
    const onSwapMeal = vi.fn();
    render(<HearthWeek {...base} days={days} onSwapMeal={onSwapMeal} />);
    const grips = screen.getAllByLabelText('Move meal');
    hitTest('2026-07-20');

    fireEvent.pointerDown(grips[0]!, { clientX: 10, clientY: 10 });
    fireEvent(window, new MouseEvent('pointerup', {}));

    expect(onSwapMeal).not.toHaveBeenCalled();
  });

  it('tears down the drag on pointercancel without committing a swap', () => {
    const onSwapMeal = vi.fn();
    render(<HearthWeek {...base} days={days} onSwapMeal={onSwapMeal} />);
    const grips = screen.getAllByLabelText('Move meal');
    hitTest('2026-07-21');

    fireEvent.pointerDown(grips[0]!, { clientX: 10, clientY: 10 });
    fireEvent(window, new MouseEvent('pointermove', { clientX: 300, clientY: 10 }));
    // Touch scroll takeover / palm rejection: pointercancel instead of pointerup.
    fireEvent(window, new Event('pointercancel'));

    expect(onSwapMeal).not.toHaveBeenCalled();
    // Ghost/drag-source styling should be cleared, not stuck.
    expect(screen.queryByText('Pie')).toBeInTheDocument(); // supper label still renders normally
    expect(document.querySelector('.fixed.z-50')).not.toBeInTheDocument(); // no stuck ghost
  });

  it('removes window listeners left by an in-progress drag on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const onSwapMeal = vi.fn();
    const { unmount } = render(<HearthWeek {...base} days={days} onSwapMeal={onSwapMeal} />);
    const grips = screen.getAllByLabelText('Move meal');

    fireEvent.pointerDown(grips[0]!, { clientX: 10, clientY: 10 });
    const addedTypes = addSpy.mock.calls.map((c) => c[0]);
    expect(addedTypes).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));

    unmount();

    const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedTypes).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']));
    expect(onSwapMeal).not.toHaveBeenCalled();

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
