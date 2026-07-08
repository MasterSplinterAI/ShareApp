import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser speech recognition for the public demo (Chrome/Edge/Safari).
 * Falls back gracefully when unavailable.
 */
export function useDemoSpeechRecognition({ lang = 'en-US', onResult, maxDurationMs = 12000 }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(Boolean(SR));
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      recognitionRef.current?.stop?.();
    };
  }, []);

  const stop = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    recognitionRef.current?.stop?.();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    stop();
    const recognition = new SR();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) onResult?.(transcript);
      stop();
    };

    recognition.onerror = () => stop();
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();

    timeoutRef.current = setTimeout(() => stop(), maxDurationMs);
  }, [lang, maxDurationMs, onResult, stop]);

  return { supported, listening, start, stop };
}

/** Map demo language codes to BCP-47 for Web Speech API. */
export function demoLangToSpeechLocale(code) {
  const map = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-BR',
    ja: 'ja-JP',
  };
  return map[code] || 'en-US';
}

/**
 * Optional browser TTS for demo bot lines (Phase C).
 */
export function speakDemoLine(text, langCode) {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = demoLangToSpeechLocale(langCode);
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

/** Promise-based TTS for sequential turn-taking in the demo room. */
export function speakDemoLineAsync(text, langCode) {
  return new Promise((resolve) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = demoLangToSpeechLocale(langCode);
    utter.rate = 0.95;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

/** Rough delay when TTS is off so agent "speaking" still feels natural. */
export function estimateSpeechMs(text) {
  if (!text) return 1400;
  return Math.min(9000, Math.max(1400, text.length * 52));
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stopDemoSpeech() {
  window.speechSynthesis?.cancel?.();
}
