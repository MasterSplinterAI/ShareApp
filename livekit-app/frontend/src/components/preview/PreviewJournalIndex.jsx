import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Clock } from 'lucide-react';
import LaliaSupportLauncher from '../../v2/components/LaliaSupportLauncher';
import {
  EditorialConversionBand,
  EditorialFooter,
  EditorialNav,
  EditorialPreviewBar,
} from './EditorialChrome';
import { ArticleCoverIllustration } from './EditorialIllustrations';
import { JOURNAL_ARTICLES, JOURNAL_CATEGORIES } from './journalArticles';

const EDITORIAL_FONT_STYLE = {
  fontFamily: "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const HEADING_FONT_STYLE = {
  fontFamily: "'Manrope', 'Inter', sans-serif",
};

export default function PreviewJournalIndex() {
  const [activeCategory, setActiveCategory] = useState('all');

  const featuredArticle =
    JOURNAL_ARTICLES.find((a) => a.featured) || JOURNAL_ARTICLES[0];
  const filteredArticles =
    activeCategory === 'all'
      ? JOURNAL_ARTICLES
      : JOURNAL_ARTICLES.filter((a) => a.pillar === activeCategory);

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      style={EDITORIAL_FONT_STYLE}
    >
      <EditorialPreviewBar />
      <EditorialNav />

      <main>
        {/* 1. Magazine Header */}
        <section className="border-b border-slate-200/80 bg-white py-16 sm:py-20 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-end justify-between gap-8 lg:grid-cols-[1.6fr_1fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                  THE LALIA JOURNAL · MEETINGS WITHOUT BORDERS
                </p>
                <h1
                  className="mt-3 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white"
                  style={{ ...HEADING_FONT_STYLE, lineHeight: 1.06 }}
                >
                  A world of ideas.
                  <span className="mt-1 block text-blue-600 dark:text-blue-400">
                    Closer conversations.
                  </span>
                </h1>
              </div>

              <div className="space-y-4 lg:border-l lg:border-slate-200 lg:pl-8 dark:lg:border-slate-800">
                <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
                  Practical guides, decision frameworks, and honest notes on running clearer conversations across languages—whether you speak with clients, suppliers, or teammates.
                </p>
                <div className="flex items-center gap-4 text-xs font-semibold text-blue-600 dark:text-blue-400">
                  <Link
                    to="/demo"
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    Try the live voice demo
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <Link
                    to="/v2/signup"
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    Start talking for free
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Featured Story Card */}
        {featuredArticle && (
          <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 sm:pt-16">
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span>THE LATEST CONVERSATION</span>
              <span>FEATURED STORY</span>
            </div>

            <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm sm:p-8 lg:p-10 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
                <div>
                  <ArticleCoverIllustration
                    variant={featuredArticle.coverVariant}
                    props={featuredArticle.coverProps}
                    compact
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                      {featuredArticle.eyebrow}
                    </span>
                    <span>·</span>
                    <span>{featuredArticle.published}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {featuredArticle.readMinutes} min read
                    </span>
                  </div>

                  <Link
                    to={`/preview/blog/${featuredArticle.slug}`}
                    className="group mt-4 block"
                  >
                    <h2
                      className="text-2xl font-extrabold tracking-tight text-slate-900 transition-colors group-hover:text-blue-600 sm:text-3xl lg:text-4xl dark:text-white dark:group-hover:text-blue-400"
                      style={{ ...HEADING_FONT_STYLE, lineHeight: 1.12 }}
                    >
                      {featuredArticle.h1Line1}
                      <span className="mt-1 block text-blue-600 dark:text-blue-400">
                        {featuredArticle.h1Line2}
                      </span>
                    </h2>
                  </Link>

                  <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300">
                    {featuredArticle.deck}
                  </p>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5 dark:border-slate-800">
                    <div className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 font-bold text-white dark:bg-blue-600">
                        {featuredArticle.author.monogram}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {featuredArticle.author.name}
                      </span>
                    </div>

                    <Link
                      to={`/preview/blog/${featuredArticle.slug}`}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
                    >
                      Read the story
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 3. Category Filter Pills & Secondary Story Grid ("FROM THE JOURNAL") */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4 dark:border-slate-800">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              FROM THE JOURNAL · IDEAS WORTH SHARING
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {JOURNAL_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {filteredArticles.map((article) => (
              <article
                key={article.slug}
                className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="p-4 pb-0">
                    <ArticleCoverIllustration
                      variant={article.coverVariant}
                      props={article.coverProps}
                      compact
                    />
                  </div>

                  <div className="p-6">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400">
                        {article.eyebrow}
                      </span>
                      <span>·</span>
                      <span>{article.published}</span>
                      <span>·</span>
                      <span>{article.readMinutes} min read</span>
                    </div>

                    <Link to={`/preview/blog/${article.slug}`} className="mt-3 block">
                      <h3
                        className="text-xl font-extrabold leading-snug text-slate-900 transition-colors group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400"
                        style={HEADING_FONT_STYLE}
                      >
                        {article.h1Line1}{' '}
                        <span className="text-slate-600 dark:text-slate-300">
                          {article.h1Line2}
                        </span>
                      </h3>
                    </Link>

                    <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {article.deck}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 text-xs font-semibold text-blue-600 dark:border-slate-800 dark:text-blue-400">
                  <span>Read the story</span>
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 4. Closing Conversion Band */}
        <EditorialConversionBand />
      </main>

      <EditorialFooter />
      <LaliaSupportLauncher audience="public" />
    </div>
  );
}
