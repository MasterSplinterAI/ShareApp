import { FileText, Sparkles, Download, Mail, ListChecks, Scale } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const TEMPLATE_KEYS = [
  { key: 'executive', icon: FileText },
  { key: 'actions', icon: ListChecks },
  { key: 'decisions', icon: Scale },
];

/**
 * Marketing section: AI-synthesized meeting reports.
 */
export default function AiReports() {
  const { t } = useTranslation();

  return (
    <section id="ai-reports" className="scroll-mt-20 border-y border-border/60 bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.2em] text-primary">
              <Sparkles className="h-4 w-4" />
              {t('aiReports.eyebrow')}
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
              {t('aiReports.title')}
            </h2>
            <p className="mt-4 text-muted-foreground">{t('aiReports.subtitle')}</p>
            <ul className="mt-6 space-y-3">
              {TEMPLATE_KEYS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{t(`aiReports.templates.${key}.label`)}</div>
                    <div className="text-sm text-muted-foreground">{t(`aiReports.templates.${key}.desc`)}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1">
                <Download className="h-3.5 w-3.5" /> {t('aiReports.badges.download')}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1">
                <Mail className="h-3.5 w-3.5" /> {t('aiReports.badges.email')}
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-primary/10 via-transparent to-primary/5" aria-hidden="true" />
            <div className="relative rounded-2xl border border-border bg-background p-6 shadow-lg">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                {t('aiReports.mock.label')}
              </div>
              <h3 className="mt-1 text-lg font-semibold">Q2 Partner Kickoff</h3>
              <p className="text-xs text-muted-foreground">{t('aiReports.mock.meta')}</p>
              <div className="my-3 h-px bg-border" />
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-medium text-primary">{t('aiReports.mock.keyPoints')}</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    <li>María confirmed LATAM rollout begins July 1 (said in Spanish, captured in English)</li>
                    <li>Pricing localization owned by Claire — draft due Friday</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-primary">{t('aiReports.mock.decisions')}</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    <li>Weekly syncs move to Tuesdays, 9:00 AM ET</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-primary">{t('aiReports.mock.nextSteps')}</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    <li>Kenneth shares the onboarding deck <span className="italic">(due: not stated)</span></li>
                  </ul>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                  <Download className="h-3 w-3" /> PDF
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium">
                  .md
                </span>
                <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium">
                  <Mail className="h-3 w-3" /> Email
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
