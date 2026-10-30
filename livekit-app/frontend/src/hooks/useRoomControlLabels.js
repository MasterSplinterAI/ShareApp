import { useEffect, useMemo, useState } from 'react';
import { chatService } from '../services/api';
import { controlLabel, ROOM_CONTROL_LABEL_KEYS } from '../lib/controlLabels';
import { isCoreUiLocale } from '../lib/i18n/uiLanguages';
import { normalizeMeetingLanguageCode } from '../lib/languages';

const roomLabelCache = new Map();
const roomLabelInFlight = new Map();

function cacheKey(language, key) {
  return `${language}:${key}`;
}

function shouldTranslateWithService(language) {
  const normalized = normalizeMeetingLanguageCode(language);
  return normalized !== 'en' && !isCoreUiLocale(normalized);
}

export function useRoomControlLabels(language) {
  const normalized = normalizeMeetingLanguageCode(language);
  const [translations, setTranslations] = useState({});

  useEffect(() => {
    let alive = true;

    if (!shouldTranslateWithService(normalized)) {
      setTranslations({});
      return () => {
        alive = false;
      };
    }

    const cached = {};
    const missing = [];
    for (const key of ROOM_CONTROL_LABEL_KEYS) {
      const hit = roomLabelCache.get(cacheKey(normalized, key));
      if (hit) cached[key] = hit;
      else missing.push(key);
    }
    setTranslations(cached);

    if (!missing.length) {
      return () => {
        alive = false;
      };
    }

    void (async () => {
      const pairs = await Promise.all(
        missing.map(async (key) => {
          const keyForCache = cacheKey(normalized, key);
          const inFlight = roomLabelInFlight.get(keyForCache);
          if (inFlight) return inFlight;

          const source = controlLabel('en', key);
          const promise = chatService
            .translate(source, 'en', normalized)
            .then((translated) => [key, translated || source])
            .finally(() => {
              roomLabelInFlight.delete(keyForCache);
            });
          roomLabelInFlight.set(keyForCache, promise);
          return promise;
        })
      );
      if (!alive) return;
      const next = { ...cached };
      for (const [key, translated] of pairs) {
        roomLabelCache.set(cacheKey(normalized, key), translated);
        next[key] = translated;
      }
      setTranslations(next);
    })();

    return () => {
      alive = false;
    };
  }, [normalized]);

  return useMemo(
    () => (key) => translations[key] || controlLabel(normalized, key),
    [normalized, translations]
  );
}
