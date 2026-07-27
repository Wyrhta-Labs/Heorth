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
 */
export default function EventChip({ occurrence: o, membersById, dimmed, large }: Props) {
  const { t } = useTranslation();
  const { formatTime } = useFormatters();
  const attr = resolveAttribution(o, membersById);
  const mirrored = isMirroredEvent(o);
  const family = attr.kind === 'family';
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border-l-4 bg-card/80 py-1.5 pl-2 pr-2 ${large ? 'text-lg' : 'text-base'} ${dimmed ? 'opacity-40' : ''}`}
      style={{ borderLeftColor: attr.color }}
      title={family ? t('hearth.event.familyCalendar') : attr.label ? `${attr.label}${mirrored ? ' · Microsoft 365' : ''}` : undefined}
    >
      <span className="mt-0.5 shrink-0 font-medium text-ash" style={{ minWidth: large ? '5rem' : '4rem' }}>
        {o.allDay ? t('hearth.event.allDay') : formatTime(o.occurrenceStart)}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{o.title}</span>
      {family && (
        <span
          className="mt-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: attr.color }}
        >
          {t('hearth.event.family')}
        </span>
      )}
    </div>
  );
}
