import { User, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const AUDIENCE_KEYS = [
  { key: 'personal', icon: User, itemKeys: ['free', 'guest', 'solo'] },
  { key: 'team', icon: Users, itemKeys: ['workspace', 'usage', 'enterprise'] },
];

export function WhoItsFor() {
  const { t } = useTranslation();

  return (
    <section id="audience" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('audience.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('audience.title')}</h2>
          <p className="mt-4 text-base text-muted-foreground">{t('audience.subtitle')}</p>
        </div>

        <div className="mt-12 grid gap-6 sm:mt-16 md:grid-cols-2">
          {AUDIENCE_KEYS.map(({ key, icon: Icon, itemKeys }) => (
            <Card key={key} className="border-border/80 bg-card/50">
              <CardHeader className="space-y-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-xl">{t(`audience.${key}.title`)}</CardTitle>
                <CardDescription className="text-sm leading-relaxed">{t(`audience.${key}.description`)}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {itemKeys.map((itemKey) => (
                    <li key={itemKey} className="flex gap-2">
                      <span className="text-primary" aria-hidden>
                        ·
                      </span>
                      <span>{t(`audience.${key}.items.${itemKey}`)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
