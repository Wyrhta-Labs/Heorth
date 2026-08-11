import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/hooks/use-formatters';
import { resolveAttribution } from '@/lib/hearth';
import { isMirroredEvent, type EventOccurrence, type Member } from '@/lib/types';

interface Props {
  occurrence: EventOccurrence;
  membersById: Record<string, Member>;
  /** Grey out (a member's feed is stale). */
  dimmed?: boolean;
  large?: boolean;
}

/**
 * A read-only calendar event on the wall. Colour attribution: a member's own
 * avatar colour, or the household's shared amber band for family-feed events
 * (see the family-colour policy in lib/hearth.ts). No edit affordance — the wall
 * never edits events.
 *
 * Timed events render as time + title behind the attribution band. All-day
 * events render as a full-width banner instead: a subtle fill tinted from the
 * attribution colour and no time gutter (squeezing "Ganztägig" into the gutter
 * was unreadable at wall distance), plus a small outlined "all day" badge.
 */
export default function EventChip({ occurrence: o, membersById, dimmed, large }: Props) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  const attr = resolveAttribution(o, membersById);
  const mirrored = isMirroredEvent(o);
  const family = attr.kind === 'family';
  const hoverTitle = family ? t('hearth.event.familyCalendar') : attr.label ? `${attr.label}${mirrored ? ' · Microsoft 365' : ''}` : undefined;
  const familyBadge = family ? (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: attr.color }}
    >
      {t('hearth.event.family')}
    </span>
  ) : null;

  if (o.allDay) {
    return (
      <div
        data-allday
        className={`flex items-center gap-2 rounded-lg border-l-4 py-1.5 pl-2 pr-2 ${large ? 'text-lg' : 'text-base'} ${dimmed ? 'opacity-40' : ''}`}
        style={{ borderLeftColor: attr.color, backgroundColor: `${attr.color}26` }}
        title={hoverTitle}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{o.title}</span>
        <span
          className="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium text-ash"
          style={{ borderColor: `${attr.color}59` }}
        >
          {t('hearth.event.allDay')}
        </span>
        {familyBadge}
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border-l-4 bg-card/80 py-1.5 pl-2 pr-2 ${large ? 'text-lg' : 'text-base'} ${dimmed ? 'opacity-40' : ''}`}
      style={{ borderLeftColor: attr.color }}
      title={hoverTitle}
    >
      <span className="mt-0.5 shrink-0 font-medium text-ash" style={{ minWidth: large ? '5rem' : '4rem' }}>
        {formatTime(o.occurrenceStart)}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{o.title}</span>
      {familyBadge && <span className="mt-0.5 flex shrink-0">{familyBadge}</span>}
    </div>
  );
}
