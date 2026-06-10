import { FileText, Sparkles, Download, Mail, ListChecks, Scale } from 'lucide-react';

const TEMPLATES = [
  { icon: FileText, label: 'Executive summary', desc: 'Overview, key points, decisions, risks, next steps' },
  { icon: ListChecks, label: 'Action items', desc: 'Owners, actions, and due dates pulled from the conversation' },
  { icon: Scale, label: 'Decisions & open questions', desc: 'What was decided vs. what still needs an answer' },
];

/**
 * Marketing section: AI-synthesized meeting reports.
 * Mirrors the real product capability (transcript → templated AI report →
 * PDF/Markdown download or email).
 */
export default function AiReports() {
  return (
    <section id="ai-reports" className="border-t border-border/60 bg-muted/30 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Copy */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-primary">
              <Sparkles className="h-4 w-4" />
              AI meeting reports
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Your meeting, distilled — in any language it was spoken.
            </h2>
            <p className="mt-4 text-muted-foreground">
              When transcript storage is on, Parley turns the full multilingual conversation into a
              polished report: executive summaries, action items with owners, decisions and open
              questions. Grounded only in what was actually said — gaps are flagged, never invented.
            </p>
            <ul className="mt-6 space-y-3">
              {TEMPLATES.map((t) => (
                <li key={t.label} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <t.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-sm text-muted-foreground">{t.desc}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1">
                <Download className="h-3.5 w-3.5" /> Download as PDF or Markdown
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1">
                <Mail className="h-3.5 w-3.5" /> Email to your team
              </span>
            </div>
          </div>

          {/* Mock report card */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-primary/10 via-transparent to-primary/5" aria-hidden="true" />
            <div className="relative rounded-2xl border border-border bg-background p-6 shadow-lg">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                Parley meeting report
              </div>
              <h3 className="mt-1 text-lg font-semibold">Q2 Partner Kickoff</h3>
              <p className="text-xs text-muted-foreground">
                Executive summary · Generated in 12s · 214 transcript lines · EN / ES / FR
              </p>
              <div className="my-3 h-px bg-border" />
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-medium text-primary">Key points</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    <li>María confirmed LATAM rollout begins July 1 (said in Spanish, captured in English)</li>
                    <li>Pricing localization owned by Claire — draft due Friday</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-primary">Decisions</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    <li>Weekly syncs move to Tuesdays, 9:00 AM ET</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-primary">Next steps</div>
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
