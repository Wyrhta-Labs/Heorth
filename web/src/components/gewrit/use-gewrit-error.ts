import { useTranslation } from 'react-i18next';
import { ApiError } from '@/api/client';

const KNOWN = ['PROVIDER_UNAVAILABLE', 'PROVIDER_AUTH', 'DOCUMENT_NOT_FOUND', 'ALREADY_LINKED', 'ELEMENT_NOT_FOUND'] as const;
type Known = (typeof KNOWN)[number];

/** Error → a translated sentence. A 403 is the role guard (FORBIDDEN); raw
 *  codes and server messages never reach the member. */
export function useGewritError(): (e: unknown) => string {
  const { t } = useTranslation();
  return (e) => {
    if (e instanceof ApiError) {
      if (e.status === 403) return t('gewrit.errors.FORBIDDEN');
      if ((KNOWN as readonly string[]).includes(e.code)) return t(`gewrit.errors.${e.code as Known}`);
    }
    return t('gewrit.errors.generic');
  };
}
