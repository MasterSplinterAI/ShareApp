import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';

const faqs = [
  {
    q: 'Do guests need an account?',
    a: 'No. Hosts share a guest join URL (and an invite token when your policy requires it). Guests enter a display name and join the LiveKit room.',
  },
  {
    q: 'Is transcript storage required?',
    a: 'No. Each meeting can opt in to saving finalized caption lines on the server. Hosts and org admins can download later when lines exist.',
  },
  {
    q: 'Can I try it before paying?',
    a: 'Yes. The free plan includes 60 participant-minutes per month—no credit card required. Upgrade anytime when you need more.',
  },
  {
    q: 'Where is data stored?',
    a: 'Meetings are processed in real time. Transcripts are stored only when the host enables storage for a meeting, and can be deleted at any time. All data is encrypted in transit.',
  },
  {
    q: 'How accurate is the live translation?',
    a: 'Parley uses real-time speech recognition with multi-language translation. Accuracy depends on audio quality—it works best when speakers use a headset in a quiet environment.',
  },
];

export function FAQ() {
  return (
    <section id="faq" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">FAQ</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-4 text-base text-muted-foreground">Straight answers, no marketing fluff.</p>
        </div>
        <Accordion type="single" collapsible className="mt-10 w-full sm:mt-12">
          {faqs.map((item, i) => (
            <AccordionItem key={item.q} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-sm font-medium text-foreground hover:no-underline">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
