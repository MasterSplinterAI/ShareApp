import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { MarketingNav } from '../marketing/MarketingNav';
import { MarketingFooter } from '../marketing/MarketingFooter';
import LaliaSupportLauncher from '../../v2/components/LaliaSupportLauncher';

// TODO: replace with the final legal entity name once incorporated.
const COMPANY_LEGAL_NAME = 'Lalia';
const LAST_UPDATED = 'June 13, 2026';
const CONTACT_EMAIL = 'hello@lalia.cloud';

function Section({ title, children }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <p className="mt-8 text-base leading-relaxed text-muted-foreground">
          This Privacy Policy explains how {COMPANY_LEGAL_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or
          &ldquo;our&rdquo;) collects, uses, and shares information when you use Lalia, our video-conferencing
          service with real-time translation and live captions (the &ldquo;Service&rdquo;).
        </p>

        <Section title="1. Information We Collect">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <span className="font-medium text-foreground">Account information.</span> When you create an account, we
              collect your name, email address, and password (stored in hashed form), along with organization details
              you provide.
            </li>
            <li>
              <span className="font-medium text-foreground">Meeting metadata.</span> We collect information about
              meetings, such as meeting titles, participant display names, join and leave times, durations, and
              language settings.
            </li>
            <li>
              <span className="font-medium text-foreground">Transcripts (optional).</span> Caption and transcript text
              is stored only when the meeting host enables transcript storage for that meeting. Otherwise, captions and
              translations are processed in real time and are not retained.
            </li>
            <li>
              <span className="font-medium text-foreground">Usage and cost telemetry.</span> We collect usage data
              such as feature usage, participant-minutes, and service-cost metrics to operate billing, enforce plan
              limits, and improve the Service.
            </li>
            <li>
              <span className="font-medium text-foreground">Payment information.</span> Payments are handled by our
              payment processor. We do not store full payment card numbers.
            </li>
            <li>
              <span className="font-medium text-foreground">Support submissions.</span> When you contact us or use
              in-app help, we collect your message, category (support, bug, or feature request), optional attachments,
              and technical context such as browser type, page URL, and meeting settings to investigate and respond.
            </li>
            <li>
              <span className="font-medium text-foreground">Communication preferences.</span> If you opt in, we may
              store your preferences for product updates by email and, when available, text or phone. You can change
              these preferences in account settings.
            </li>
          </ul>
        </Section>

        <Section title="2. How We Use Information">
          <ul className="list-disc space-y-1 pl-6">
            <li>Provide, operate, and maintain the Service, including real-time captions and translation;</li>
            <li>Manage accounts, subscriptions, billing, and plan limits;</li>
            <li>Communicate with you about the Service, including support and important notices;</li>
            <li>Send optional product updates when you have opted in;</li>
            <li>Monitor performance, prevent abuse, and keep the Service secure;</li>
            <li>Improve and develop the Service, including triaging support with automated tools;</li>
            <li>Comply with legal obligations.</li>
          </ul>
          <p>We do not sell your personal information.</p>
        </Section>

        <Section title="3. Marketing Communications">
          <p>
            Transactional messages (such as password resets, billing receipts, security alerts, and replies to your
            support tickets) are sent as part of the Service and do not require separate marketing consent.
          </p>
          <p>
            Product updates and promotional emails are sent only if you opt in. You can withdraw consent at any time in
            account settings or by contacting us. SMS and phone marketing are not offered until we enable those channels
            and obtain any additional consent required by law.
          </p>
        </Section>

        <Section title="4. Data Retention">
          <p>
            Meeting audio and video are processed in real time and are not recorded by the Service. Transcripts are
            retained only when the host enables storage for a meeting, and hosts and organization admins can delete
            stored transcripts at any time. Account information is retained while your account is active; when you
            delete your account, we delete or anonymize your personal information within a reasonable period, except
            where retention is required for legal, billing, or security purposes.
          </p>
        </Section>

        <Section title="5. How We Share Information">
          <p>We share information only with service providers that help us operate the Service, including:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Hosting and infrastructure providers that run the Service and real-time media;</li>
            <li>Speech-to-text and translation providers that process meeting audio to generate captions and translations;</li>
            <li>Our payment processor, for subscription billing.</li>
          </ul>
          <p>
            These providers process data on our behalf under contractual obligations. We may also disclose information
            if required by law, to protect our rights or the safety of users, or in connection with a merger,
            acquisition, or sale of assets (with notice where required).
          </p>
        </Section>

        <Section title="6. Security">
          <p>
            We use industry-standard safeguards to protect your information. Data is encrypted in transit, account
            passwords are stored in hashed form, and access to production systems is restricted. No method of
            transmission or storage is completely secure, so we cannot guarantee absolute security; please use a
            strong, unique password for your account.
          </p>
        </Section>

        <Section title="7. Your Rights">
          <p>
            Depending on where you live, you may have rights to access, correct, export, or delete your personal
            information, and to object to or restrict certain processing. You can manage much of your data directly in
            the Service (including deleting stored transcripts), or contact us at{' '}
            <a className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{' '}
            to exercise your rights. We will respond within the timeframes required by applicable law.
          </p>
        </Section>

        <Section title="8. Children's Privacy">
          <p>
            The Service is not directed to children under 13 (or the applicable minimum age in your jurisdiction), and
            we do not knowingly collect personal information from them. If you believe a child has provided us with
            personal information, please contact us so we can delete it.
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. If we make material changes, we will provide notice
            through the Service or by email. The &ldquo;Last updated&rdquo; date at the top reflects the most recent
            revision.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions about this Privacy Policy or our data practices? Contact us at{' '}
            <a className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </main>
      <MarketingFooter />
      <LaliaSupportLauncher audience="public" />
    </div>
  );
}
