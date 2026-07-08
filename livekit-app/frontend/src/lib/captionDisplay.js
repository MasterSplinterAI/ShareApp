/** Caption display helpers — viewer locale primary, original source below when different. */

export function sourceLangLabel(code) {
  return (code || 'en').split('-')[0].toUpperCase();
}

export function getCaptionDisplay({ originalText, primary, secondary, sourceLang, readLang }) {
  if (primary != null) {
    return {
      primary,
      secondary: secondary || null,
      sourceLang: sourceLang || readLang || 'en',
    };
  }

  const src = sourceLang || 'en';
  const tgt = readLang || 'en';
  if (src === tgt) {
    return { primary: originalText, secondary: null, sourceLang: src };
  }
  return {
    primary: originalText,
    secondary: null,
    sourceLang: src,
  };
}
