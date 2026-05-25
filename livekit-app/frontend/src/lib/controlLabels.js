const CONTROL_LABELS = {
  en: {
    microphone: 'Microphone',
    camera: 'Camera',
    shareScreen: 'Share screen',
    stopSharing: 'Stop sharing',
    chat: 'Chat',
    people: 'People',
    share: 'Share',
    leave: 'Leave',
    startAudio: 'Click to enable audio',
  },
  es: {
    microphone: 'Micrófono',
    camera: 'Cámara',
    shareScreen: 'Compartir pantalla',
    stopSharing: 'Dejar de compartir',
    chat: 'Chat',
    people: 'Personas',
    share: 'Compartir',
    leave: 'Salir',
    startAudio: 'Haz clic para activar el audio',
  },
};

export function controlLabel(language, key) {
  const base = String(language || 'en').split('-')[0].toLowerCase();
  return CONTROL_LABELS[base]?.[key] || CONTROL_LABELS.en[key] || key;
}
