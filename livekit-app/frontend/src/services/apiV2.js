import axios from 'axios';

const isNgrok =
  window.location.hostname.includes('ngrok.app') ||
  window.location.hostname.includes('ngrok-free.app') ||
  window.location.hostname.includes('ngrok.io');
const isNetworkAccess = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
const isHTTPS = window.location.protocol === 'https:';

let base = import.meta.env.VITE_API_URL || '/api';
if (isNgrok || (isNetworkAccess && isHTTPS)) {
  base = '/api';
} else if (isNetworkAccess) {
  base = `http://${window.location.hostname}:3001/api`;
}

const apiV2 = axios.create({
  baseURL: `${base.replace(/\/$/, '')}/v2`,
  headers: { 'Content-Type': 'application/json' },
});

apiV2.interceptors.request.use((config) => {
  const token = localStorage.getItem('v2_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const v2Auth = {
  signup: (body) => apiV2.post('/auth/signup', body).then((r) => r.data),
  login: (body) => apiV2.post('/auth/login', body).then((r) => r.data),
  me: () => apiV2.get('/auth/me').then((r) => r.data),
};

export const v2Orgs = {
  me: () => apiV2.get('/orgs/me').then((r) => r.data),
};

export const v2Meetings = {
  list: () => apiV2.get('/meetings').then((r) => r.data),
  create: (body) => apiV2.post('/meetings', body).then((r) => r.data),
  get: (id) => apiV2.get(`/meetings/${id}`).then((r) => r.data),
  patch: (id, body) => apiV2.patch(`/meetings/${id}`, body).then((r) => r.data),
  token: (id, body) => apiV2.post(`/meetings/${id}/token`, body).then((r) => r.data),
};

export const v2Host = {
  participants: (meetingId) => apiV2.get(`/host/meetings/${meetingId}/participants`).then((r) => r.data),
  removeParticipant: (meetingId, identity) =>
    apiV2.post(`/host/meetings/${meetingId}/participants/${encodeURIComponent(identity)}/remove`).then((r) => r.data),
  endMeeting: (meetingId) => apiV2.post(`/host/meetings/${meetingId}/end`).then((r) => r.data),
};

export const v2Billing = {
  plans: () => apiV2.get('/billing/plans').then((r) => r.data),
  subscription: () => apiV2.get('/billing/subscription').then((r) => r.data),
  settleDryRun: (body) => apiV2.post('/billing/settle-dry-run', body || {}).then((r) => r.data),
};

export const v2Usage = {
  recordEvent: (body) => apiV2.post('/usage/events', body).then((r) => r.data),
  summary: () => apiV2.get('/usage/summary').then((r) => r.data),
  rollup: (body) => apiV2.post('/usage/rollup', body || {}).then((r) => r.data),
};

export const v2Files = {
  list: () => apiV2.get('/files').then((r) => r.data),
  upload: (formData) =>
    apiV2.post('/files', formData, {
      transformRequest: [
        (data, headers) => {
          if (typeof FormData !== 'undefined' && data instanceof FormData) {
            delete headers['Content-Type'];
          }
          return data;
        },
      ],
    }).then((r) => r.data),
  downloadUrl: (id) => `${base.replace(/\/$/, '')}/v2/files/${id}/download`,
};

export default apiV2;
