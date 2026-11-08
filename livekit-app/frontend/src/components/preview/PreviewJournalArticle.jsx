import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Info,
  Quote,
  Sparkles,
} from 'lucide-react';
import { Button } from '../ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../ui/accordion';
import LaliaSupportLauncher from '../../v2/components/LaliaSupportLauncher';
import {
  EditorialConversionBand,
  EditorialFooter,
  EditorialNav,
  EditorialPreviewBar,
} from './EditorialChrome';
import { ArticleCoverIllustration } from './EditorialIllustrations';
import { getJournalArticleBySlug, JOURNAL_ARTICLES } from './journalArticles';

const EDITORIAL_FONT_STYLE = {
  fontFamily: "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const HEADING_FONT_STYLE = {
  fontFamily: "'Manrope', 'Inter', sans-serif",
};

export default function PreviewJournalArticle() {
  const { slug } = useParams();
  const article = getJournalArticleBySlug(slug);
  const [activeHeading, setActiveHeading] = useState(
    article?.toc?.[0]?.id || ''
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (article?.toc?.[0]?.id) {
      setActiveHeading(article.toc[0].id);
    }
  }, [slug, article]);

  useEffect(() => {
    if (!article?.toc?.length) return undefined;
    const onScroll = () => {
      let current = article.toc[0].id;
      for (const item of article.toc) {
        const el = document.getElementById(item.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 160) {
            current = item.id;
          }
        }
      }
      setActiveHeading(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [article]);

  if (!article) {
    return <Navigate to="/preview/blog" replace />;
  }

  const relatedArticles = JOURNAL_ARTICLES.filter(
    (a) => a.slug !== article.slug
  );

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveHeading(id);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      style={EDITORIAL_FONT_STYLE}
    >
      <EditorialPreviewBar />
      <EditorialNav />

      <main>
        {/* Article Header */}
        <header className="border-b border-slate-200/80 bg-white py-12 sm:py-16 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <Link
              to="/preview/blog"
              className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Lalia Journal
            </Link>

            <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
              {article.eyebrow}
            </p>

            <h1
              className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white"
              style={{ ...HEADING_FONT_STYLE, lineHeight: 1.08 }}
            >
              {article.h1Line1}
              <span className="mt-1 block text-blue-600 dark:text-blue-400">
                {article.h1Line2}
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
              {article.deck}
            </p>

            {/* Quiet Byline */}
            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-slate-200/80 pt-5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-extrabold text-white">
                {article.author.monogram}
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {article.author.name}
              </span>
              <span>·</span>
              <span>{article.published}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {article.readMinutes} min read
              </span>
            </div>

            {/* Custom CSS Cover Art */}
            <div className="mt-8">
              <ArticleCoverIllustration
                variant={article.coverVariant}
                props={article.coverProps}
              />
            </div>
          </div>
        </header>

        {/* Article Body + Sticky Left TOC */}
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="grid items-start gap-12 lg:grid-cols-[260px_minmax(0,680px)] lg:justify-center">
            {/* Sticky Left Aside ("IN THIS ARTICLE" + Embedded Demo CTA) */}
            <aside className="lg:sticky lg:top-24">
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  IN THIS ARTICLE
                </p>
                <nav className="mt-3 space-y-1.5" aria-label="Table of contents">
                  {article.toc.map((item) => {
                    const active = activeHeading === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => scrollToSection(item.id)}
                        className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs leading-snug transition-colors ${
                          active
                            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </nav>

                {/* Embedded TOC Conversion Card */}
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    Hear it in your own language
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Test live voice translation and bilingual captions in your browser—no account needed.
                  </p>
                  <Link
                    to="/demo"
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
                  >
                    Try the live demo
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link
                    to="/v2/signup"
                    className="mt-2 block text-center text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Or start talking for free ↗
                  </Link>
                </div>
              </div>
            </aside>

            {/* Main 680px Reading Column */}
            <article className="min-w-0 space-y-10">
              {/* Key Takeaways Box */}
              {article.keyTakeaways?.length > 0 && (
                <div className="rounded-2xl border border-blue-200/80 bg-blue-50/70 p-6 dark:border-blue-500/30 dark:bg-blue-950/30">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                    <Sparkles className="h-4 w-4" />
                    Key takeaways
                  </div>
                  <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                    {article.keyTakeaways.map((kt, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        <span>{kt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Oversized Article Lead Paragraph */}
              <p className="text-lg font-medium leading-[1.8] text-slate-900 sm:text-xl dark:text-slate-100">
                {article.lead}
              </p>

              {/* Sections */}
              {article.sections.map((sec) => (
                <section key={sec.id} id={sec.id} className="scroll-mt-24 space-y-5">
                  {sec.heading && (
                    <h2
                      className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white"
                      style={HEADING_FONT_STYLE}
                    >
                      {sec.heading}
                    </h2>
                  )}

                  {sec.paragraphs?.map((p, i) => (
                    <p
                      key={i}
                      className="text-base leading-[1.85] text-slate-700 dark:text-slate-300"
                    >
                      {p}
                    </p>
                  ))}

                  {/* Bullets */}
                  {sec.bullets?.length > 0 && (
                    <ul className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
                      {sec.bullets.map((b, i) => (
                        <li
                          key={i}
                          className="text-sm leading-relaxed text-slate-700 sm:text-base dark:text-slate-300"
                        >
                          <strong className="font-bold text-slate-900 dark:text-white">
                            {b.title}
                          </strong>{' '}
                          {b.text}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Comparison Table / Decision Matrix */}
                  {sec.table && (
                    <div className="my-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                      {sec.table.caption && (
                        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                          {sec.table.caption}
                        </div>
                      )}
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900">
                              {sec.table.columns.map((col, idx) => (
                                <th
                                  key={idx}
                                  className={`px-4 py-3 text-xs font-bold uppercase tracking-wider ${
                                    idx === sec.table.columns.length - 1
                                      ? 'text-blue-700 dark:text-blue-400'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                            {sec.table.rows.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                              >
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className={`px-4 py-3.5 align-top leading-relaxed ${
                                      cIdx === 0
                                        ? 'font-semibold text-slate-900 dark:text-white'
                                        : 'text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {sec.afterTableParagraphs?.map((p, i) => (
                    <p
                      key={i}
                      className="text-base leading-[1.85] text-slate-700 dark:text-slate-300"
                    >
                      {p}
                    </p>
                  ))}

                  {/* Centered Article PullQuote */}
                  {sec.pullQuote && (
                    <blockquote className="my-8 rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50/80 via-white to-slate-50 p-6 text-center shadow-sm sm:p-8 dark:border-blue-500/30 dark:from-blue-950/40 dark:via-slate-900 dark:to-slate-900">
                      <Quote className="mx-auto h-6 w-6 text-blue-600 dark:text-blue-400" />
                      <p
                        className="mt-3 text-xl font-bold leading-snug text-slate-900 sm:text-2xl dark:text-white"
                        style={HEADING_FONT_STYLE}
                      >
                        “{sec.pullQuote}”
                      </p>
                    </blockquote>
                  )}

                  {/* Numbered Article Steps */}
                  {sec.steps?.length > 0 && (
                    <ol className="space-y-3">
                      {sec.steps.map((st, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-mono text-xs font-bold text-white">
                            {idx + 1}
                          </span>
                          <div>
                            <p
                              className="text-base font-bold text-slate-900 dark:text-white"
                              style={HEADING_FONT_STYLE}
                            >
                              {st.name}
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                              {st.text}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}

                  {/* Honesty / Note Callout */}
                  {sec.callout && (
                    <div
                      className={`rounded-2xl border p-5 sm:p-6 ${
                        sec.callout.tone === 'caution'
                          ? 'border-amber-300/80 bg-amber-50/80 text-slate-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-slate-100'
                          : 'border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {sec.callout.tone === 'caution' ? (
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
                        )}
                        <div>
                          <p className="text-sm font-bold">{sec.callout.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                            {sec.callout.text}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inline Earned CTA */}
                  {sec.inlineCta && (
                    <div className="rounded-2xl border border-blue-200/90 bg-gradient-to-br from-blue-50/90 via-white to-slate-50 p-6 shadow-sm dark:border-blue-500/30 dark:from-blue-950/40 dark:via-slate-900 dark:to-slate-900">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
                        {sec.inlineCta.eyebrow}
                      </p>
                      <h3
                        className="mt-1.5 text-xl font-bold text-slate-900 dark:text-white"
                        style={HEADING_FONT_STYLE}
                      >
                        {sec.inlineCta.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {sec.inlineCta.body}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Button
                          asChild
                          size="sm"
                          className="bg-blue-600 text-white hover:bg-blue-500"
                        >
                          <Link to={sec.inlineCta.primaryHref}>
                            {sec.inlineCta.primaryLabel}
                          </Link>
                        </Button>
                        {sec.inlineCta.secondaryLabel && (
                          <Button asChild variant="outline" size="sm">
                            <Link to={sec.inlineCta.secondaryHref}>
                              {sec.inlineCta.secondaryLabel}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              ))}

              {/* Interactive FAQ Block */}
              {article.faq?.length > 0 && (
                <section id="faq" className="scroll-mt-24 space-y-4 border-t border-slate-200/80 pt-10 dark:border-slate-800">
                  <h2
                    className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-white"
                    style={HEADING_FONT_STYLE}
                  >
                    Frequently asked questions
                  </h2>
                  <Accordion
                    type="single"
                    collapsible
                    className="divide-y divide-slate-200/80 rounded-2xl border border-slate-200/90 bg-white px-5 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
                  >
                    {article.faq.map((item, idx) => (
                      <AccordionItem
                        key={idx}
                        value={`faq-${idx}`}
                        className="border-b-0"
                      >
                        <AccordionTrigger className="py-4 text-left text-sm font-bold text-slate-900 hover:no-underline sm:text-base dark:text-white">
                          {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="pb-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          {item.a}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </section>
              )}

              {/* Source & Editorial Honesty Note */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-100/70 p-4 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                Explore the{' '}
                <Link
                  to="/preview/home"
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Lalia calling, translation, and meeting features
                </Link>{' '}
                described in this guide. Scenarios above are illustrative examples of how a meeting can work, not customer case studies. Product details were verified against Lalia’s current capabilities on {article.published}.
              </div>

              {/* Related Stories */}
              {relatedArticles.length > 0 && (
                <section className="space-y-4 border-t border-slate-200/80 pt-10 dark:border-slate-800">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
                    KEEP READING
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {relatedArticles.map((rel) => (
                      <Link
                        key={rel.slug}
                        to={`/preview/blog/${rel.slug}`}
                        className="group rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                          {rel.eyebrow}
                        </span>
                        <h3
                          className="mt-2 text-base font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400"
                          style={HEADING_FONT_STYLE}
                        >
                          {rel.title}
                        </h3>
                        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                          Read story
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </article>
          </div>
        </div>

        {/* End-of-Article Conversion Band */}
        <EditorialConversionBand
          eyebrow="KEEP THE CONVERSATION GOING"
          line1="Save the interpreter for the moments that need one."
          line2="Make every other meeting easy."
          deck="Start with your next routine call. Choose your languages, hear the translation, read along on screen, and send a shared summary when you’re done."
        />
      </main>

      <EditorialFooter />
      <LaliaSupportLauncher audience="public" />
    </div>
  );
}
