/**
 * Lalia Journal — Structured Article Collection
 * Combines the best of the Claude Opus and OpenAI GPT-5.6 editorial blueprints,
 * plus the Slate & Royal Blue edition of "Meet without a translator."
 */

export const JOURNAL_CATEGORIES = [
  { id: 'all', label: 'All stories' },
  { id: 'interpreters-captions-ai-translation', label: 'Interpreters & AI translation' },
  { id: 'how-it-works', label: 'How live translation works' },
  { id: 'multilingual-meetings', label: 'Multilingual meetings' },
];

export const JOURNAL_ARTICLES = [
  {
    slug: 'interpreter-or-live-ai-translation',
    featured: true,
    eyebrow: 'CHOOSING THE RIGHT SUPPORT',
    categoryLabel: 'Interpreters & AI translation',
    pillar: 'interpreters-captions-ai-translation',
    h1Line1: 'Interpreter or live AI translation?',
    h1Line2: 'Choose by the meeting, not the habit.',
    title: 'Interpreter or live AI translation? How to choose for every meeting',
    seoTitle: 'Interpreter vs AI Translation: How to Choose | Lalia Journal',
    deck: 'Some conversations need a professional interpreter. Many don’t. Here is a practical way to tell the difference and set up each meeting so everyone is understood.',
    metaDescription:
      'Not every multilingual meeting needs the same support. Use this guide to decide when live AI translation fits and when to book a professional interpreter.',
    author: {
      name: 'Lalia Editorial',
      role: 'Lalia Team',
      monogram: 'l.',
    },
    published: 'November 8, 2026',
    publishedIso: '2026-11-08',
    readMinutes: 8,
    coverVariant: 'decision-bridge',
    coverProps: {
      leftBadge: 'QUALIFIED INTERPRETER',
      leftTitle: 'Certified, specialist, accountable',
      leftSub: 'Legal, medical, regulated & high-stakes negotiations',
      rightBadge: 'LIVE AI TRANSLATION',
      rightTitle: 'Everyday, instant, self-serve',
      rightSub: 'Check-ins, supplier updates, intros & team calls',
      caption: 'Two kinds of support. One goal: everyone understood.',
    },
    keyTakeaways: [
      'Choose by stakes, not by language. The question isn’t “do we speak different languages?” It’s “what happens if one sentence is misunderstood?”',
      'Book a qualified interpreter for legal, medical, regulated, or emotionally sensitive conversations, or wherever policy requires one.',
      'Live AI translation fits the everyday meetings that are frequent, short, and recoverable: check-ins, supplier updates, introductions, and follow-ups.',
      'In the middle, combine them. Spoken translation plus live bilingual captions and written confirmation of key numbers close most of the gap.',
      'Whatever you choose, confirm the critical facts (names, numbers, dates, owners) in writing before you hang up.',
    ],
    toc: [
      { id: 'question-first', label: 'The question to ask first' },
      { id: 'side-by-side', label: 'Side by side: what each option is built for' },
      { id: 'decision-guide', label: 'A decision guide for 10 common meetings' },
      { id: 'middle-ground', label: 'The middle ground: combining both' },
      { id: 'run-it-well', label: 'How to run a translated meeting well' },
      { id: 'faq', label: 'Frequently asked questions' },
    ],
    lead: 'Your supplier in Monterrey has a shipping delay to explain. Your new colleague in Lyon has questions about onboarding. A prospect in São Paulo wants a product walkthrough on Thursday. Three conversations, three languages, and one recurring question: do we need an interpreter for this?',
    sections: [
      {
        id: 'intro-body',
        paragraphs: [
          'For a long time the honest answer was “yes, or muddle through in a shared second language.” Now there is a real third option. Live AI translation lets each person speak their own language and hear or read the conversation in theirs. That is useful, but it doesn’t make the decision go away. It changes the decision.',
          'This guide gives you a way to make that call quickly, meeting by meeting, without overpaying for routine conversations or under-protecting the important ones.',
        ],
      },
      {
        id: 'question-first',
        heading: 'The question to ask first',
        paragraphs: [
          'Most teams decide on language support by habit. “We always book an interpreter for Japan.” “We just use English with that supplier.” Habits are cheap to follow and expensive when they are wrong in either direction.',
          'A better first question is about consequences: If one sentence in this meeting were misunderstood, what would it cost, and could we catch it in time?',
          'That single question sorts almost every meeting into one of three bands:',
        ],
        bullets: [
          {
            title: 'Recoverable.',
            text: 'A misunderstanding is caught in the next sentence and costs a few minutes. Weekly check-ins, status updates, scheduling, introductions, internal brainstorming.',
          },
          {
            title: 'Consequential.',
            text: 'A misunderstanding could cost money, time, or a relationship, but it would surface before becoming permanent. Pricing discussions, scope changes, supplier specifications, product walkthroughs.',
          },
          {
            title: 'Critical or regulated.',
            text: 'A misunderstanding could cause harm, create legal exposure, or cannot be undone. Court and legal proceedings, medical consultations, safety briefings, formal contract negotiations, sensitive HR matters, and any setting where rules require a qualified interpreter.',
          },
        ],
      },
      {
        id: 'side-by-side',
        heading: 'Side by side: what each option is built for',
        paragraphs: [
          'Professional interpreters and live AI translation are good at different things. Treating them as interchangeable is where most mistakes start.',
        ],
        table: {
          caption: 'Professional interpreter vs. live AI translation: what each is built for',
          columns: ['Decision factor', 'Professional interpreter', 'Live AI translation (Lalia)'],
          rows: [
            [
              'Best for',
              'High-stakes, regulated, specialist, or emotionally sensitive conversations',
              'Frequent, everyday, recoverable and spontaneous conversations',
            ],
            [
              'How it works',
              'A trained person renders meaning consecutively or simultaneously, handling tone, idiom, and cultural context',
              'Speech is recognized, translated, and delivered as spoken audio and bilingual captions as people talk',
            ],
            [
              'Judgment & nuance',
              'High — can clarify, flag ambiguity, and adapt to cultural context',
              'Literal-leaning — works best with clear, plain speech and one speaker at a time',
            ],
            [
              'Accountability',
              'A named professional, often certified, sometimes legally required',
              'A software tool — participants confirm critical details themselves',
            ],
            [
              'Scheduling',
              'Booked in advance, often with minimum booking windows',
              'Available the moment a call or meeting starts, including 1-tap unplanned calls',
            ],
            [
              'Scales to',
              'The interpreters you can book for each language pair',
              '30+ languages in the same room — each participant picks their own language lane',
            ],
            [
              'Written record',
              'Usually separate (manual notes or a separate transcriber)',
              'Optional bilingual transcript plus reviewed AI summaries and action items',
            ],
          ],
        },
        afterTableParagraphs: [
          'Two rows in that table do most of the work: Judgment and Availability.',
          'An interpreter notices when a word lands wrong, when a “yes” means “I heard you” rather than “I agree,” or when a question needs reframing for the room. Software doesn’t do that, and you shouldn’t expect it to.',
          'Meanwhile, most multilingual conversations at a growing company aren’t board meetings. They’re the ten-minute call that needs to happen today. If the only options are “book an interpreter for Thursday” or “struggle through in a second language,” many of those conversations simply don’t happen. That is the gap live translation fills.',
        ],
        pullQuote:
          'Interpreters bring judgment. Live translation brings availability. Most teams need both, for different meetings.',
      },
      {
        id: 'decision-guide',
        heading: 'A decision guide for 10 common meetings',
        paragraphs: [
          'Here is how the three stakes bands map onto meetings most teams actually run. Use it as a starting point and adjust for your industry, your relationship with the other party, and any regulations that apply to you.',
        ],
        table: {
          caption: 'Recommended language support across 10 common meeting types',
          columns: ['Meeting type', 'Stakes band', 'Recommended support'],
          rows: [
            ['Weekly team check-in', 'Recoverable', 'Live AI translation'],
            ['Supplier status or shipping update', 'Recoverable', 'Live AI translation + written recap'],
            ['First introduction with a prospect', 'Recoverable', 'Live AI translation'],
            [
              'Product demo / sales walkthrough',
              'Recoverable → Consequential',
              'Live AI translation; confirm pricing in writing',
            ],
            [
              'Scope or specification change',
              'Consequential',
              'Live AI translation + written confirmation of every number and date',
            ],
            [
              'Contract or final pricing negotiation',
              'Consequential → Critical',
              'Interpreter for final terms; live translation for prep calls',
            ],
            [
              'Performance or disciplinary conversation',
              'Critical',
              'Qualified interpreter (with HR guidance)',
            ],
            [
              'Safety briefing or incident review',
              'Critical',
              'Qualified interpreter + translated written materials',
            ],
            ['Medical consultation', 'Critical / Regulated', 'Qualified medical interpreter'],
            ['Legal proceeding or deposition', 'Critical / Regulated', 'Court-qualified interpreter'],
          ],
        },
        callout: {
          tone: 'caution',
          title: 'When not to use live AI translation',
          text: 'If the conversation is legal, medical, or safety-critical, if a regulation or policy calls for a qualified interpreter, or if a misunderstanding could not be corrected afterward, book a professional. Live translation can still help with scheduling and prep around those meetings—it shouldn’t carry the regulated session itself.',
        },
        inlineCta: {
          eyebrow: 'HEAR IT BEFORE YOU DECIDE',
          title: 'Test a live translated exchange in your browser.',
          body: 'The fastest way to judge whether live voice translation suits your everyday calls is to try a real exchange. No download or account required.',
          primaryLabel: 'Try the live voice demo ↗',
          primaryHref: '/demo',
          secondaryLabel: 'Start talking for free',
          secondaryHref: '/v2/signup',
        },
      },
      {
        id: 'middle-ground',
        heading: 'The middle ground: combining both',
        paragraphs: [
          'The most interesting band is the middle one: consequential meetings where booking an interpreter feels heavy, but a casual approach feels risky. Teams that handle this band well layer a few simple habits on top of live translation:',
        ],
        bullets: [
          {
            title: '1. Listen and read along together.',
            text: 'Lalia pairs spoken voice translation with live bilingual captions. Hearing a sentence in your language and seeing both the original and translated text on screen is a natural double-check—especially for names and figures.',
          },
          {
            title: '2. Put critical numbers in writing during the call.',
            text: 'Product codes, quantities, prices, and delivery dates should go into the meeting chat or be confirmed aloud (“Let me repeat that date to be sure”). It takes five seconds and removes most of the risk.',
          },
          {
            title: '3. Close with a shared, reviewed summary.',
            text: 'When the host enables transcript storage for a meeting, Lalia can generate an executive summary, action items, or a decisions report from the bilingual transcript. Review owners, dates, and figures before emailing it to participants.',
          },
          {
            title: '4. Use live translation to prepare for interpreted sessions.',
            text: 'Run the agenda alignment, technical prep calls, and post-meeting follow-ups with live translation, and save the human interpreter’s time for the session where their specialist judgment matters most.',
          },
        ],
      },
      {
        id: 'run-it-well',
        heading: 'How to run a translated meeting well',
        paragraphs: [
          'Once you’ve decided a conversation suits live translation, six small habits make the experience noticeably clearer for everyone in the room:',
        ],
        steps: [
          {
            name: 'Pick the right format for the call',
            text: 'Use a 1-on-1 Direct Call to ring a saved contact’s phone or browser in one tap, or create a Meeting Room when you want a shareable guest link, scannable QR code, or calendar invite for a group.',
          },
          {
            name: 'Let everyone choose their own language',
            text: 'Each participant selects the language they speak and want to hear/read on the pre-join screen. Nobody has to defer to a single “meeting language.”',
          },
          {
            name: 'Do a ten-second sound check',
            text: 'Ask everyone to say a quick hello and confirm they hear the translated voice and see live captions. A headset and a quiet room make the biggest difference to speech recognition.',
          },
          {
            name: 'Speak in complete, plain sentences, then pause',
            text: 'Finish a thought, then leave a natural beat. Avoid talking over one another; crosstalk is hard for both human interpreters and speech models.',
          },
          {
            name: 'Spell out names, numbers, and codes',
            text: 'Drop proper nouns, part numbers, and dates into chat as well as saying them aloud.',
          },
          {
            name: 'Confirm decisions and send the recap',
            text: 'Recap owners and next steps before hanging up. If transcript storage is enabled, review the AI summary and email it to everyone in one click.',
          },
        ],
        callout: {
          tone: 'note',
          title: 'A note on privacy and recordings',
          text: 'Lalia does not record meeting audio or video. Captions and voice translation are processed in real time, and transcript text is saved only when the host turns on storage for that specific meeting. Lalia never uses your meeting content to train its own models.',
        },
      },
    ],
    faq: [
      {
        q: 'Can live AI translation replace a professional interpreter?',
        a: 'For many routine, everyday meetings it removes the need to book one. For legal, medical, safety-critical, or regulated conversations—or anywhere a misunderstanding cannot be undone—a qualified human interpreter remains the right choice.',
      },
      {
        q: 'How accurate is live AI translation?',
        a: 'Accuracy depends on audio quality and speaking style. It works best with a headset, a quiet room, one person speaking at a time, and clear sentences. Always confirm critical names, numbers, and dates in writing.',
      },
      {
        q: 'Do guests need to download an app or create an account to join?',
        a: 'No. Hosts can share a guest link or QR code, and guests join directly in their mobile or desktop browser without installing anything or creating an account. Installing the iOS or Android app is optional and adds native lock-screen call ringing.',
      },
      {
        q: 'How many languages does Lalia support?',
        a: 'Lalia supports live captions and spoken translation across 30+ languages—including English, Spanish (including regional variants), French, German, Portuguese, Japanese, Mandarin Chinese, Arabic, Russian, Korean, and Hindi.',
      },
      {
        q: 'Are translated meetings recorded?',
        a: 'No. Lalia does not record meeting audio or video. Transcript text is saved only if the host enables transcript storage for that meeting, and stored transcripts can be deleted at any time.',
      },
      {
        q: 'Can I try live translation before paying?',
        a: 'Yes. You can test the interactive voice demo in your browser without an account, and the Free plan includes 60 participant-minutes per month with no credit card required.',
      },
    ],
  },
  {
    slug: 'how-real-time-voice-translation-works-in-live-calls',
    featured: false,
    eyebrow: 'INSIDE THE CONVERSATION',
    categoryLabel: 'How live translation works',
    pillar: 'how-it-works',
    h1Line1: 'Real-time translation without the awkwardness.',
    h1Line2: 'How bilingual calls actually work.',
    title: 'Real-time meeting translation without the awkwardness: how bilingual calls actually work',
    seoTitle: 'How Real-Time Voice Translation Works in Live Calls | Lalia Journal',
    deck: 'What happens between the moment you speak in English and the moment your counterpart hears natural Spanish—and how to keep a cross-language call feeling human.',
    metaDescription:
      'See how real-time voice translation and bilingual captions work together in live 1-on-1 calls and group meetings, from audio ducking to clause-level pacing.',
    author: {
      name: 'Lalia Editorial',
      role: 'Lalia Team',
      monogram: 'l.',
    },
    published: 'November 8, 2026',
    publishedIso: '2026-11-08',
    readMinutes: 6,
    coverVariant: 'voice-bubbles',
    coverProps: {
      youSayLang: 'ENGLISH · YOU SAY',
      youSayText: 'We can ship the first order on Thursday, once packaging is approved.',
      theyHearLang: 'ESPAÑOL · THEY HEAR',
      theyHearText: 'Podemos enviar el primer pedido el jueves, una vez aprobado el empaque.',
      caption: 'Spoken translation + live bilingual captions in the same room.',
    },
    keyTakeaways: [
      'Listening and reading solve different problems: spoken translation keeps the conversation flowing, while bilingual captions let you verify exact wording and numbers.',
      'Smart audio ducking lowers the original speaker’s microphone volume while translated speech plays, then restores it smoothly so voices never clash.',
      'Code-switching support lets bilingual speakers switch languages mid-call without opening settings menus.',
      'Guests can join from any mobile or desktop browser via link or QR code, while regular contacts can ring each other’s phones directly like FaceTime or WhatsApp.',
    ],
    toc: [
      { id: 'why-old-calls-stalled', label: 'Why traditional cross-language calls feel slow' },
      { id: 'three-layers', label: 'Three layers working together: speech, captions, and ducking' },
      { id: 'direct-call-vs-room', label: 'Direct calls vs. meeting rooms: two ways to connect' },
      { id: 'workflow-comparison', label: 'Comparing 4 ways teams handle multilingual calls' },
      { id: 'faq', label: 'Frequently asked questions' },
    ],
    lead: 'Anyone who has tried to hold a working call through a pasted chat translator knows the rhythm: someone speaks for forty seconds, everyone waits in silence, a block of text appears, and by the time the other person replies, the moment has passed.',
    sections: [
      {
        id: 'why-old-calls-stalled',
        heading: 'Why traditional cross-language calls feel slow',
        paragraphs: [
          'A real conversation depends on momentum. You hear tone, you see someone nod, and you respond while the thought is still fresh. When translation is bolted onto a call as a separate copy-paste step—or when captions only appear in a single language after a long delay—people stop talking to each other and start talking to the tool.',
          'To make a bilingual call feel like a normal conversation, translation has to happen inside the call itself, at the clause level, with both voice and text working together.',
        ],
      },
      {
        id: 'three-layers',
        heading: 'Three layers working together: speech, captions, and ducking',
        paragraphs: [
          'When two or more people talk in Lalia, three things happen in parallel so nobody loses the thread:',
        ],
        bullets: [
          {
            title: '1. Live bilingual captions as you speak.',
            text: 'As soon as someone starts talking, Lalia streams live speech recognition and stabilizing interim translation so listeners see the sentence taking shape on screen—with the speaker’s original words alongside the translation.',
          },
          {
            title: '2. Clause-level spoken voice translation.',
            text: 'Rather than waiting for a long monologue to finish, completed sentences and clauses are voiced in the listener’s chosen language while the speaker continues, keeping spoken latency tight.',
          },
          {
            title: '3. Automatic audio ducking.',
            text: 'When translated voice audio plays for you, Lalia gently lowers the speaker’s original microphone volume to 20% so you can still hear their human cadence without two voices competing at full volume—then restores their mic smoothly as soon as the translated phrase finishes.',
          },
        ],
        pullQuote:
          'You hear their real voice for tone, their words in your language for meaning, and the bilingual caption on screen for certainty.',
      },
      {
        id: 'direct-call-vs-room',
        heading: 'Direct calls vs. meeting rooms: two ways to connect',
        paragraphs: [
          'Not every cross-language conversation is a scheduled calendar event. Lalia is built around two everyday workflows:',
        ],
        bullets: [
          {
            title: '1-Tap Direct Calls (like WhatsApp or FaceTime).',
            text: 'Save a colleague, supplier, or friend by email in your Contacts list and tap Call. If they have the Lalia iOS or Android app, their phone rings on the lock screen via native CallKit; if they are on a computer, they get an instant browser ring and join link.',
          },
          {
            title: 'Instant or Scheduled Meeting Rooms.',
            text: 'When you are meeting with external clients or a group across three or four languages, create a room with a shareable guest link, a scannable QR code for in-person handoffs, or calendar invites with automatic timezone labels.',
          },
        ],
        inlineCta: {
          eyebrow: 'TRY THE LIVE PIPELINE',
          title: 'Speak in your language and hear the translation live.',
          body: 'Open an interactive demo room in your browser and test live voice translation and bilingual captions with AI teammates.',
          primaryLabel: 'Try the live voice demo ↗',
          primaryHref: '/demo',
          secondaryLabel: 'Create free account',
          secondaryHref: '/v2/signup',
        },
      },
      {
        id: 'workflow-comparison',
        heading: 'Comparing 4 ways teams handle multilingual calls',
        paragraphs: [
          'Here is how an integrated translated call compares with the workarounds teams often piece together:',
        ],
        table: {
          caption: 'Comparison of everyday multilingual meeting workflows',
          columns: [
            'Workflow',
            'How people follow along',
            'Setup friction',
            'Follow-up record',
          ],
          rows: [
            [
              'Shared second language only',
              'Everyone speaks the host’s language at varying fluency',
              'None, but quieter teammates often hold back questions',
              'Single-language notes',
            ],
            [
              'Video call + pasted chat translator',
              'Participants type or paste paragraphs into a side window',
              'High — breaks eye contact and slows turn-taking',
              'Scattered chat fragments',
            ],
            [
              'Post-call transcription bot',
              'No live translation during the call; transcript arrives afterward',
              'Low, but doesn’t help people understand each other live',
              'Post-call transcript only',
            ],
            [
              'Lalia (Live voice + bilingual captions)',
              'Each participant hears and reads their own chosen language live',
              '1-tap direct call or browser guest link (no guest install)',
              'Optional bilingual transcript + AI summary & action items',
            ],
          ],
        },
      },
    ],
    faq: [
      {
        q: 'What happens if someone switches languages mid-sentence?',
        a: 'Lalia’s code-switching pipeline detects spoken language and script changes automatically, routing translation to each listener’s target language even when a bilingual speaker switches between languages mid-call.',
      },
      {
        q: 'Will other participants hear my translated voice track?',
        a: 'No. Each participant’s browser or app subscribes only to the audio track for their own selected language, so everyone hears only the translation meant for them.',
      },
      {
        q: 'Can someone join from a phone without installing the app?',
        a: 'Yes. Tapping a guest link or scanning a meeting QR code opens the pre-join lobby directly in mobile Safari or Chrome.',
      },
    ],
  },
  {
    slug: 'meetings-without-translators',
    featured: false,
    eyebrow: 'MEETINGS WITHOUT BORDERS',
    categoryLabel: 'Multilingual meetings',
    pillar: 'multilingual-meetings',
    h1Line1: 'Meet without a translator.',
    h1Line2: 'Keep the conversation going.',
    title: 'Meet without a translator. Keep the conversation going.',
    seoTitle: 'Meet Without a Translator: Keep the Conversation Going | Lalia Journal',
    deck: 'When language stops being a scheduling hurdle, teams talk more often, decide faster, and leave with the same shared next steps.',
    metaDescription:
      'A client has a question. A supplier has an update. See how live voice translation and bilingual captions help teams meet across languages without scheduling friction.',
    author: {
      name: 'Lalia Editorial',
      role: 'Lalia Team',
      monogram: 'l.',
    },
    published: 'November 7, 2026',
    publishedIso: '2026-11-07',
    readMinutes: 5,
    coverVariant: 'language-bridge',
    coverProps: {
      leftLang: 'English',
      leftQuote: '“Let’s build something together.”',
      rightLang: 'Español',
      rightQuote: '«Construyamos algo juntos.»',
      caption: 'Your voice. Their language. The same conversation.',
    },
    keyTakeaways: [
      'A routine conversation shouldn’t wait days for language coordination—when two people need ten minutes to align, they should be able to talk today.',
      'Combining spoken voice translation with live bilingual captions lets everyone participate naturally in their own language.',
      'Optional bilingual transcripts and reviewed AI summaries ensure everyone leaves the call with the same decisions and action items.',
    ],
    toc: [
      { id: 'before-the-call', label: 'Start with the people, not the logistics' },
      { id: 'during-the-call', label: 'Speak naturally. Follow in your own language.' },
      { id: 'where-it-helps', label: 'Where everyday translation changes the week' },
      { id: 'clarity-after', label: 'Keep the clarity after the call' },
      { id: 'faq', label: 'Frequently asked questions' },
    ],
    lead: 'A client has a question. A supplier has an update. Your team needs to make a decision. None of those moments should have to wait three days while you search for someone who can translate between you.',
    sections: [
      {
        id: 'before-the-call',
        heading: 'Start with the people, not the logistics',
        paragraphs: [
          'In most international work, the hardest part of a cross-language conversation isn’t the thirty minutes you spend talking. It’s the hesitation beforehand. People send three long emails instead of making a five-minute call because they worry about talking past each other.',
          'When live translation is built into the room, starting a multilingual call looks the same as starting any other call: you ring a contact directly or send a guest link, each person picks their language on the way in, and you begin.',
        ],
      },
      {
        id: 'during-the-call',
        heading: 'Speak naturally. Follow in your own language.',
        paragraphs: [
          'During the conversation, each person speaks the language they think best in. Lalia translates speech in real time—delivering both spoken voice translation and live bilingual captions on screen.',
          'If you want to lean back and listen, the spoken translation carries the flow. If you want to double-check a part number, a date, or a phrasing, the original and translated captions are right there on screen.',
        ],
        pullQuote: 'Your voice. Their language. The same conversation.',
      },
      {
        id: 'where-it-helps',
        heading: 'Where everyday translation changes the week',
        paragraphs: [
          'The biggest shift happens in the conversations that used to be skipped or delayed. (The scenarios below are illustrative examples of how teams use Lalia, rather than customer case studies.)',
        ],
        bullets: [
          {
            title: 'Client introductions and walkthroughs.',
            text: 'A prospect can ask questions in their own language and hear your answers in theirs, without a third party relaying every sentence.',
          },
          {
            title: 'Supplier and manufacturing check-ins.',
            text: 'When a specification or delivery date shifts, operations leads and factory partners can jump on a ten-minute call and confirm the fix on the spot.',
          },
          {
            title: 'Distributed team standups.',
            text: 'Engineers, designers, and regional leads across offices can share updates in their strongest language while everyone follows along effortlessly.',
          },
        ],
        callout: {
          tone: 'caution',
          title: 'Know when a human interpreter is still the right call',
          text: 'Live AI translation is built for everyday collaboration. Legal proceedings, medical discussions, safety-critical briefings, and certified negotiations may still call for a qualified human interpreter.',
        },
      },
      {
        id: 'clarity-after',
        heading: 'Keep the clarity after the call',
        paragraphs: [
          'Understanding each other during the meeting is half the job; leaving with the same record of what was decided is the other half.',
          'When the host enables transcript storage for a meeting, Lalia saves the bilingual transcript and lets you generate an AI executive summary, action items, or decisions report—ready to review and email to every participant in one click.',
        ],
      },
    ],
    faq: [
      {
        q: 'Do guests need a Lalia account to join my meeting?',
        a: 'No. Guests open your invite link or scan your QR code, enter their display name, pick their language, and join directly in their web browser.',
      },
      {
        q: 'Can I call someone 1-on-1 without scheduling a meeting?',
        a: 'Yes. Save their email in Contacts and tap Call to ring them directly in the Lalia app or send an instant join link.',
      },
    ],
  },
];

export function getJournalArticleBySlug(slug) {
  return JOURNAL_ARTICLES.find((a) => a.slug === slug) || null;
}
