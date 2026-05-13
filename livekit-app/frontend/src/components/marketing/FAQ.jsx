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
    q: 'What happened to the old “instant meeting” home?',
    a: 'The classic non-workspace flow was retired in favor of organizations and meetings. Hosts start sessions from the V2 workspace; guests still use /join links.',
  },
  {
    q: 'Where is data stored?',
    a: 'Workspace data lives in the platform database on the deployment you use. Back up the SQLite file (or migrate to Postgres) per your ops policy.',
  },
  {
    q: 'Can I use this in production today?',
    a: 'Staging validates the product path; production rollout should follow your checklist: secrets, HTTPS, backups, and billing when enabled.',
  },
];

export function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
      <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">FAQ</h2>
      <p className="mt-3 text-center text-sm text-muted-foreground">Straight answers—no marketing fluff.</p>
      <Accordion type="single" collapsible className="mt-10 w-full">
        {faqs.map((item, i) => (
          <AccordionItem key={item.q} value={`item-${i}`}>
            <AccordionTrigger className="text-left text-sm font-medium text-foreground hover:no-underline">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
