import { MarketingNav } from '../marketing/MarketingNav';
import { MarketingFooter } from '../marketing/MarketingFooter';

const COMPANY_LEGAL_NAME = 'Jar Metals LLC';
const LAST_UPDATED = 'June 10, 2026';
const CONTACT_EMAIL = 'hello@parley.app';

function Section({ title, children }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Parley, a video-conferencing
          service with real-time translation and live captions (the &ldquo;Service&rdquo;), operated by{' '}
          {COMPANY_LEGAL_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;). Please read these Terms
          carefully before using the Service.
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using the Service, you agree to be bound by these Terms and our Privacy Policy. If you are
            using the Service on behalf of an organization, you represent that you have authority to bind that
            organization, and &ldquo;you&rdquo; refers to that organization. If you do not agree to these Terms, do not
            use the Service.
          </p>
        </Section>

        <Section title="2. Description of the Service">
          <p>
            Parley provides video meetings with real-time speech recognition, live captions, and multi-language
            translation, along with workspace tools for organizing teams and meetings. Translation and transcription
            are generated automatically and provided on a best-effort basis; accuracy may vary depending on audio
            quality, language, and other factors. We may modify, add, or remove features of the Service from time to
            time.
          </p>
        </Section>

        <Section title="3. Accounts and Registration">
          <p>
            Some features require an account. You agree to provide accurate, current information when registering and
            to keep your credentials secure. You are responsible for all activity that occurs under your account.
            Notify us promptly at{' '}
            <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{' '}
            if you suspect unauthorized use of your account.
          </p>
          <p>
            Meeting guests may join sessions via invite links without creating an account. Hosts are responsible for
            who they invite to their meetings.
          </p>
        </Section>

        <Section title="4. Acceptable Use">
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Violate any applicable law or regulation, or infringe the rights of others;</li>
            <li>Record, transcribe, or store communications without obtaining any consents required by law;</li>
            <li>Transmit malware, spam, or other harmful or unsolicited content;</li>
            <li>Harass, threaten, or abuse other users;</li>
            <li>Attempt to gain unauthorized access to the Service, other accounts, or related systems;</li>
            <li>Probe, scan, or test the vulnerability of the Service without authorization;</li>
            <li>Resell, sublicense, or provide the Service to third parties except as expressly permitted.</li>
          </ul>
          <p>We may suspend or terminate access for violations of this section.</p>
        </Section>

        <Section title="5. Plans, Payment, and Subscriptions">
          <p>
            The Service offers a free plan with usage limits and paid subscription plans. Paid plans are billed in
            advance on a recurring basis (monthly or annually, as selected at purchase) and renew automatically until
            cancelled. You authorize us and our payment processor to charge your payment method for all applicable
            fees and taxes.
          </p>
          <p>
            You may cancel at any time; cancellation takes effect at the end of the current billing period. Except
            where required by law, fees are non-refundable. We may change pricing with reasonable advance notice;
            changes apply at your next renewal.
          </p>
        </Section>

        <Section title="6. Intellectual Property">
          <p>
            The Service, including its software, design, and branding, is owned by {COMPANY_LEGAL_NAME} and its
            licensors and is protected by intellectual property laws. We grant you a limited, non-exclusive,
            non-transferable, revocable license to use the Service in accordance with these Terms.
          </p>
          <p>
            You retain ownership of content you create or upload through the Service, including meeting audio, video,
            and transcripts (&ldquo;Your Content&rdquo;). You grant us a limited license to process Your Content solely
            to provide and improve the Service, including generating captions and translations in real time.
          </p>
        </Section>

        <Section title="7. Disclaimers">
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND,
            WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
            SECURE, OR THAT TRANSCRIPTIONS AND TRANSLATIONS WILL BE ACCURATE OR COMPLETE. DO NOT RELY ON AUTOMATED
            TRANSLATIONS FOR LEGAL, MEDICAL, OR OTHER HIGH-STAKES PURPOSES WITHOUT INDEPENDENT VERIFICATION.
          </p>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY_LEGAL_NAME.toUpperCase()} AND ITS OFFICERS, EMPLOYEES, AND
            AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY
            LOSS OF PROFITS, DATA, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL
            AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS
            YOU PAID US IN THE TWELVE (12) MONTHS BEFORE THE CLAIM AROSE, OR (B) ONE HUNDRED US DOLLARS (US$100).
          </p>
        </Section>

        <Section title="9. Termination">
          <p>
            You may stop using the Service or delete your account at any time. We may suspend or terminate your access
            if you breach these Terms, if required by law, or if we discontinue the Service. Upon termination, your
            right to use the Service ends; sections of these Terms that by their nature should survive (including
            Sections 6–10) will survive termination.
          </p>
        </Section>

        <Section title="10. Governing Law">
          <p>
            These Terms are governed by the laws of the jurisdiction in which {COMPANY_LEGAL_NAME} is organized,
            without regard to conflict-of-law principles. Any disputes will be resolved in the courts located in that
            jurisdiction, and the parties consent to their exclusive jurisdiction and venue.
          </p>
        </Section>

        <Section title="11. Changes to These Terms">
          <p>
            We may update these Terms from time to time. If we make material changes, we will provide notice through
            the Service or by email. Your continued use of the Service after changes take effect constitutes acceptance
            of the updated Terms.
          </p>
        </Section>

        <Section title="12. Contact">
          <p>
            Questions about these Terms? Contact us at{' '}
            <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </main>
      <MarketingFooter />
    </div>
  );
}
