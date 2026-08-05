import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWhoami } from '@/hooks/use-household';
import { DEFAULT_SETTINGS_TAB, findSettingsTab } from '@/lib/settings-tabs';

/**
 * Renders the settings tab named by the `$tab` route param.
 *
 * An unknown id and a forbidden one are handled IDENTICALLY (redirect to the
 * default tab): a tab the member may not open must not be distinguishable from
 * one that does not exist.
 */
export default function SettingsTabPanel() {
  const { t } = useTranslation();
  // `strict: false` rather than `from: '/household/$tab'`: app.tsx nests
  // /household under the pathless `auth` layout route, so its registered
  // literal is actually `/auth/household/$tab`. The test harnesses mount this
  // component under a bare `/household/$tab` tree with no such layout — a
  // `from` pinned to either literal breaks the other. `strict: false` reads
  // the param off whichever tree is actually mounted.
  const { tab } = useParams({ strict: false });
  const whoamiQuery = useWhoami();
  const member = whoamiQuery.data?.data;

  // Authorization is NOT evaluated until whoami resolves. Treating "no member
  // yet" as "not permitted" would bounce a deep link (/household/keys) back to
  // the default tab before the real role arrived.
  if (!member) return <div className="text-sm text-ash">{t('common.loading')}</div>;

  const entry = typeof tab === 'string' ? findSettingsTab(tab) : undefined;
  const access = entry?.access(member);
  if (!entry || !access?.visible) {
    return <Navigate to="/household/$tab" params={{ tab: DEFAULT_SETTINGS_TAB }} replace />;
  }

  const { Panel, card } = entry;
  const panel = <Panel readOnly={access.readOnly} />;
  if (!card) return panel;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t(card.titleKey)}</CardTitle></CardHeader>
      <CardContent>{panel}</CardContent>
    </Card>
  );
}
