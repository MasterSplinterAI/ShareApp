/**
 * Scripted scenarios for the public translation lab demo.
 * Bot lines are pre-translated to avoid burning API credits on every session.
 */

const DEMO_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
];

function line(en, es, fr, de, pt, ja) {
  return { en, es, fr, de, pt, ja };
}

function pickLine(lines, lang) {
  if (!lines) return '';
  return lines[lang] || lines.en || '';
}

const SCENARIOS = {
  standup: {
    id: 'standup',
    title: 'Global standup',
    description: 'A weekly sync with teammates in Madrid and Tokyo.',
    bot: { name: 'María', speakLang: 'es' },
    participants: [
      { id: 'maria', name: 'María', defaultLang: 'es', gradient: 'from-violet-200 to-slate-300' },
      { id: 'yuki', name: 'Yuki', defaultLang: 'ja', gradient: 'from-emerald-200 to-slate-300' },
    ],
    secondary: {
      name: 'Yuki',
      speakLang: 'ja',
      triggers: ['japan', 'japanese', 'apac', 'asia', 'materials', 'docs', 'document', 'translation'],
      lines: line(
        'はい — 日本語版の資料も必要です。Laliaのライブ翻訳があればAPACチームも同じ会議に参加できます。',
        'Sí — también necesitamos materiales en japonés. Con Lalia el equipo APAC puede seguir en la misma reunión.',
        'Oui — il nous faut aussi des documents en japonais. Avec Lalia, l’équipe APAC peut suivre la même réunion.',
        'Ja — wir brauchen auch japanische Unterlagen. Mit Lalia kann das APAC-Team im selben Meeting folgen.',
        'Sim — também precisamos de materiais em japonês. Com o Lalia a equipe APAC acompanha na mesma reunião.',
        'はい — 日本語版の資料も必要です。Laliaのライブ翻訳があればAPACチームも同じ会議に参加できます。'
      ),
    },
    opening: line(
      'Buenos días — ¿repasamos el cronograma del despliegue global?',
      'Buenos días — ¿repasamos el cronograma del despliegue global?',
      'Bonjour — passons en revue le calendrier de déploiement mondial ?',
      'Guten Morgen — gehen wir den globalen Rollout-Zeitplan durch?',
      'Bom dia — vamos revisar o cronograma de lançamento global?',
      'おはようございます。グローバル展開のスケジュールを確認しましょうか？'
    ),
    responses: [
      {
        triggers: ['timeline', 'rollout', 'schedule', 'when', 'date', 'june', 'launch', 'start', 'pilot'],
        lines: line(
          'Perfecto. El piloto en Madrid empieza el 16 de junio — compartiré el deck después.',
          'Perfecto. El piloto en Madrid empieza el 16 de junio — compartiré el deck después.',
          'Parfait. Le pilote à Madrid commence le 16 juin — je partagerai la présentation après.',
          'Perfekt. Der Pilot in Madrid startet am 16. Juni — ich teile die Präsentation danach.',
          'Perfeito. O piloto em Madrid começa em 16 de junho — compartilharei o deck depois.',
          '了解です。マドリードのパイロットは6月16日開始です。後で資料を共有します。'
        ),
      },
      {
        triggers: ['japan', 'japanese', 'apac', 'asia', 'materials', 'docs', 'document'],
        lines: line(
          'Sí — prepararemos una versión en japonés. Lalia traduce en vivo para el equipo APAC.',
          'Sí — prepararemos una versión en japonés. Lalia traduce en vivo para el equipo APAC.',
          'Oui — nous préparerons une version japonaise. Lalia traduit en direct pour l’équipe APAC.',
          'Ja — wir bereiten eine japanische Version vor. Lalia übersetzt live für das APAC-Team.',
          'Sim — prepararemos uma versão em japonês. O Lalia traduz ao vivo para a equipe APAC.',
          'はい — 日本語版を用意します。LaliaがAPACチーム向けにライブ翻訳します。'
        ),
      },
      {
        triggers: ['risk', 'blocker', 'issue', 'problem', 'concern'],
        lines: line(
          'El único riesgo es la localización de precios — Claire entrega el borrador el viernes.',
          'El único riesgo es la localización de precios — Claire entrega el borrador el viernes.',
          'Le seul risque est la localisation des prix — Claire livre le brouillon vendredi.',
          'Das einzige Risiko ist die Preislokalisierung — Claire liefert den Entwurf am Freitag.',
          'O único risco é a localização de preços — Claire entrega o rascunho na sexta.',
          '唯一のリスクは価格のローカライズです — クレアが金曜までに草案を出します。'
        ),
      },
    ],
    fallback: line(
      'Entendido — lo anoto para el acta. ¿Algo más antes de cerrar?',
      'Entendido — lo anoto para el acta. ¿Algo más antes de cerrar?',
      'Compris — je le note pour le compte rendu. Autre chose avant de conclure ?',
      'Verstanden — notiere ich fürs Protokoll. Noch etwas vor dem Abschluss?',
      'Entendido — anoto para a ata. Mais alguma coisa antes de encerrar?',
      '了解しました — 議事録に記載します。他に何かありますか？'
    ),
  },
  customer: {
    id: 'customer',
    title: 'Customer call',
    description: 'A prospect in São Paulo asks about multilingual support.',
    bot: { name: 'Ana', speakLang: 'pt' },
    participants: [
      { id: 'ana', name: 'Ana', defaultLang: 'pt', gradient: 'from-amber-200 to-slate-300' },
      { id: 'james', name: 'James', defaultLang: 'en', gradient: 'from-sky-200 to-slate-300' },
    ],
    secondary: {
      name: 'James',
      speakLang: 'en',
      triggers: ['security', 'record', 'privacy', 'data', 'gdpr', 'enterprise', 'sso'],
      lines: line(
        'Happy to jump in — we also get asked about security a lot. Lalia does not record AV; transcripts are opt-in only.',
        'Me uno — también nos preguntan mucho por seguridad. Lalia no graba audio ni vídeo.',
        'Je peux préciser — on nous pose souvent des questions sur la sécurité. Lalia n’enregistre pas l’audio.',
        'Kurz ergänzt — Sicherheit ist oft das erste Thema. Lalia zeichnet weder Audio noch Video auf.',
        'Só complementando — segurança é a pergunta mais comum. Lalia não grava áudio nem vídeo.',
        '補足します — セキュリティの質問が多いです。Laliaは音声・動画を録画しません。'
      ),
    },
    opening: line(
      'Olá — ouvi que vocês fazem reuniões com tradução ao vivo. Como funciona para convidados?',
      'Olá — ouvi que vocês fazem reuniões com tradução ao vivo. Como funciona para convidados?',
      'Bonjour — j’ai entendu que vous proposez des réunions avec traduction en direct. Comment ça marche pour les invités ?',
      'Hallo — ich habe gehört, dass Sie Meetings mit Live-Übersetzung anbieten. Wie funktioniert das für Gäste?',
      'Olá — ouvi que vocês fazem reuniões com tradução ao vivo. Como funciona para convidados?',
      'こんにちは — ライブ翻訳付きの会議があると聞きました。ゲストはどう参加しますか？'
    ),
    responses: [
      {
        triggers: ['guest', 'link', 'invite', 'join', 'account', 'download', 'browser'],
        lines: line(
          'Perfeito — o convidado abre um link no navegador, escolhe o idioma e entra sem criar conta.',
          'Perfecto — el invitado abre un enlace en el navegador, elige idioma y entra sin cuenta.',
          'Parfait — l’invité ouvre un lien dans le navigateur, choisit sa langue et rejoint sans compte.',
          'Perfekt — der Gast öffnet einen Link im Browser, wählt die Sprache und tritt ohne Konto bei.',
          'Perfeito — o convidado abre um link no navegador, escolhe o idioma e entra sem criar conta.',
          'ゲストはブラウザでリンクを開き、言語を選んでアカウントなしで参加できます。'
        ),
      },
      {
        triggers: ['price', 'cost', 'plan', 'free', 'trial', 'minute'],
        lines: line(
          'Temos um plano gratuito com 60 minutos por mês — dá para testar com um cliente real.',
          'Tenemos un plan gratuito con 60 minutos al mes — puedes probar con un cliente real.',
          'Nous avons un plan gratuit avec 60 minutes par mois — idéal pour tester avec un vrai client.',
          'Wir haben einen kostenlosen Plan mit 60 Minuten pro Monat — gut zum Testen mit echten Kunden.',
          'Temos um plano gratuito com 60 minutos por mês — dá para testar com um cliente real.',
          '月60分の無料プランがあります — 実際のクライアントで試せます。'
        ),
      },
      {
        triggers: ['security', 'record', 'privacy', 'data', 'gdpr', 'store'],
        lines: line(
          'Não gravamos áudio nem vídeo. Transcrições só são salvas se o anfitrião ativar — você controla a retenção.',
          'No grabamos audio ni vídeo. Las transcripciones solo se guardan si el anfitrión las activa.',
          'Nous n’enregistrons ni audio ni vidéo. Les transcriptions ne sont stockées que si l’hôte l’active.',
          'Wir zeichnen weder Audio noch Video auf. Transkripte werden nur gespeichert, wenn der Host es aktiviert.',
          'Não gravamos áudio nem vídeo. Transcrições só são salvas se o anfitrião ativar.',
          '音声・動画は録画しません。文字起こしはホストが有効にした場合のみ保存されます。'
        ),
      },
    ],
    fallback: line(
      'Ótima pergunta — posso enviar um resumo por e-mail depois da call.',
      'Buena pregunta — puedo enviar un resumen por correo después de la llamada.',
      'Bonne question — je peux envoyer un résumé par e-mail après l’appel.',
      'Gute Frage — ich kann nach dem Call eine Zusammenfassung per E-Mail senden.',
      'Ótima pergunta — posso enviar um resumo por e-mail depois da call.',
      '良い質問です — 通話後にメールで概要を送れます。'
    ),
  },
  interview: {
    id: 'interview',
    title: 'Interview',
    description: 'HR screens a candidate who is more comfortable in French.',
    bot: { name: 'Sophie', speakLang: 'fr' },
    participants: [
      { id: 'sophie', name: 'Sophie', defaultLang: 'fr', gradient: 'from-rose-200 to-slate-300' },
      { id: 'marco', name: 'Marco', defaultLang: 'de', gradient: 'from-indigo-200 to-slate-300' },
    ],
    secondary: {
      name: 'Marco',
      speakLang: 'de',
      triggers: ['tool', 'zoom', 'meet', 'translate', 'caption', 'software', 'lalia'],
      lines: line(
        'From engineering — we tried captions before, but live translation in-room is the difference. That is what we would use Lalia for.',
        'Desde ingeniería — probamos subtítulos, pero la traducción en vivo en la reunión marca la diferencia.',
        'Côté engineering — nous avions des sous-titres, mais la traduction en direct dans la réunion change tout.',
        'Aus dem Engineering — Untertitel hatten wir, aber Live-Übersetzung im Meeting ist der Unterschied.',
        'Do engineering — já tínhamos legendas, mas tradução ao vivo na reunião faz diferença.',
        'エンジニアリングから — 字幕は試しましたが、会議中のライブ翻訳が決め手です。'
      ),
    },
    opening: line(
      'Bonjour — merci d’être disponible. Parlez-moi de votre expérience avec des équipes internationales.',
      'Hola — gracias por tu tiempo. Cuéntame tu experiencia con equipos internacionales.',
      'Bonjour — merci d’être disponible. Parlez-moi de votre expérience avec des équipes internationales.',
      'Hallo — danke für Ihre Zeit. Erzählen Sie von Ihrer Erfahrung mit internationalen Teams.',
      'Olá — obrigado pelo tempo. Conte-me sobre sua experiência com equipes internacionais.',
      'こんにちは — お時間ありがとうございます。国際チームでの経験を教えてください。'
    ),
    responses: [
      {
        triggers: ['year', 'experience', 'worked', 'team', 'remote', 'global', 'language'],
        lines: line(
          'Très bien — chez mon dernier poste, je coordonnais des stand-ups EN/FR chaque semaine.',
          'Muy bien — en mi último puesto coordinaba stand-ups EN/ES cada semana.',
          'Très bien — chez mon dernier poste, je coordonnais des stand-ups EN/FR chaque semaine.',
          'Sehr gut — in meiner letzten Rolle koordinierte ich wöchentliche EN/DE-Stand-ups.',
          'Muito bem — no meu último cargo coordenava stand-ups EN/PT toda semana.',
          '素晴らしい — 前職では毎週EN/JAのスタンドアップを調整していました。'
        ),
      },
      {
        triggers: ['tool', 'zoom', 'meet', 'translate', 'caption', 'software'],
        lines: line(
          'Nous utilisions des sous-titres, mais pas de traduction en direct — c’est ce qui m’intéresse ici.',
          'Usábamos subtítulos, pero no traducción en vivo — eso es lo que me interesa aquí.',
          'Nous utilisions des sous-titres, mais pas de traduction en direct — c’est ce qui m’intéresse ici.',
          'Wir nutzten Untertitel, aber keine Live-Übersetzung — das interessiert mich hier.',
          'Usávamos legendas, mas não tradução ao vivo — é isso que me interessa aqui.',
          '字幕は使っていましたが、ライブ翻訳はありませんでした — ここが魅力です。'
        ),
      },
      {
        triggers: ['start', 'available', 'when', 'notice', 'salary', 'compensation'],
        lines: line(
          'Parfait — passons aux prochaines étapes. Je vous envoie le processus par e-mail.',
          'Perfecto — pasemos a los siguientes pasos. Te envío el proceso por correo.',
          'Parfait — passons aux prochaines étapes. Je vous envoie le processus par e-mail.',
          'Perfekt — kommen wir zu den nächsten Schritten. Ich sende Ihnen den Prozess per E-Mail.',
          'Perfeito — vamos às próximas etapas. Envio o processo por e-mail.',
          '了解です — 次のステップに進みましょう。プロセスをメールでお送りします。'
        ),
      },
    ],
    fallback: line(
      'Merci — c’est clair. Une dernière question : comment gérez-vous les fuseaux horaires ?',
      'Gracias — queda claro. Una última pregunta: ¿cómo manejan las zonas horarias?',
      'Merci — c’est clair. Une dernière question : comment gérez-vous les fuseaux horaires ?',
      'Danke — das ist klar. Eine letzte Frage: Wie handhaben Sie Zeitzonen?',
      'Obrigado — ficou claro. Uma última pergunta: como lidam com fusos horários?',
      'ありがとうございます — 明確です。最後の質問：タイムゾーンはどう管理していますか？'
    ),
  },
};

function listScenarios() {
  return Object.values(SCENARIOS).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    bot: s.bot,
    participants: s.participants || [],
  }));
}

function getScenarioParticipants(scenario, participantLangs = {}, userDisplayName = 'You') {
  const agents = (scenario.participants || []).map((p) => ({
    ...p,
    speakLang: participantLangs[p.name] || p.defaultLang,
  }));
  return [
    {
      id: 'you',
      name: userDisplayName,
      role: 'host',
      speakLang: participantLangs.You || 'en',
      gradient: 'from-primary/30 to-slate-300',
    },
    ...agents.map((a) => ({ ...a, role: 'agent' })),
  ];
}

function shouldSecondarySpeak(scenario, userText, turnCount) {
  if (!scenario.secondary) return false;
  const lower = userText.toLowerCase();
  if (scenario.secondary.triggers?.some((t) => lower.includes(t))) return true;
  // Occasional second voice so the room feels alive
  return turnCount > 0 && turnCount % 2 === 0;
}

function getScenario(id) {
  return SCENARIOS[id] || null;
}

function normalizeText(text) {
  return String(text || '')
    .trim()
    .slice(0, 200);
}

function matchResponse(scenario, userText) {
  const lower = userText.toLowerCase();
  for (const entry of scenario.responses) {
    if (entry.triggers.some((t) => lower.includes(t))) {
      return entry.lines;
    }
  }
  return scenario.fallback;
}

module.exports = {
  DEMO_LANGUAGES,
  SCENARIOS,
  listScenarios,
  getScenario,
  pickLine,
  normalizeText,
  matchResponse,
  getScenarioParticipants,
  shouldSecondarySpeak,
};
