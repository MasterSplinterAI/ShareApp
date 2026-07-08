import api from './api';

export const demoLabService = {
  config: () => api.get('/demo/config').then((r) => r.data),

  startSession: (body) => api.post('/demo/session', body).then((r) => r.data),

  turn: (sessionId, userText) =>
    api.post('/demo/turn', { sessionId, userText }).then((r) => r.data),

  track: (sessionId, event, metadata = {}) =>
    api.post('/demo/event', { sessionId, event, metadata }).catch(() => {}),
};
