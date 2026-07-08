import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { useTranslation } from '../../lib/i18n/I18nProvider';

const FAQ_KEYS = [
  'guests',
  'languages',
  'stack',
  'participants',
  'planLimit',
  'transcripts',
  'recording',
  'aiTraining',
  'trial',
  'storage',
  'accuracy',
];

export function FAQ() {
  const { t } = useTranslation();

  return (
    <section id="faq" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('faq.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{t('faq.title')}</h2>
          <p className="mt-4 text-base text-muted-foreground">{t('faq.subtitle')}</p>
        </div>
        <Accordion type="single" collapsible className="mt-10 w-full sm:mt-12">
          {FAQ_KEYS.map((key, i) => (
            <AccordionItem key={key} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-sm font-medium text-foreground hover:no-underline">
                {t(`faq.items.${key}.q`)}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {t(`faq.items.${key}.a`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
