import { useEffect, useState } from 'react';
import { v2Auth } from '../../services/apiV2';
import { useTranslation } from '../../lib/i18n/I18nProvider';
import DirectCallsSection from '../components/DirectCallsSection';

export default function V2CallsPage() {
  const { t } = useTranslation();
  const [me, setMe] = useState(null);

  useEffect(() => {
    v2Auth.me().then(setMe).catch(() => {});
  }, []);

  const displayName =
    me?.user?.display_name ||
    me?.user?.displayName ||
    me?.user?.email?.split('@')[0] ||
    'Host';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('calls.pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('calls.pageSubtitle')}
        </p>
      </div>

      <DirectCallsSection hostDisplayName={displayName} fullPage />
    </div>
  );
}
