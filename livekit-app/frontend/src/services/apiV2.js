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
  listMembers: () => apiV2.get('/orgs/members').then((r) => r.data),
  addMember: (body) => apiV2.post('/orgs/members', body).then((r) => r.data),
  patchMember: (userId, body) => apiV2.patch(`/orgs/members/${encodeURIComponent(userId)}`, body).then((r) => r.data),
  removeMember: (userId) => apiV2.delete(`/orgs/members/${encodeURIComponent(userId)}`).then((r) => r.data),
  adminPing: () => apiV2.get('/orgs/admin/ping').then((r) => r.data),
  adminOrgs: () => apiV2.get('/orgs/admin/orgs').then((r) => r.data),
  adminPatchOrg: (orgId, body) => apiV2.patch(`/orgs/admin/orgs/${encodeURIComponent(orgId)}`, body).then((r) => r.data),
};

export const v2Meetings = {
  list: () => apiV2.get('/meetings').then((r) => r.data),
  create: (body) => apiV2.post('/meetings', body).then((r) => r.data),
  get: (id) => apiV2.get(`/meetings/${id}`).then((r) => r.data),
  patch: (id, body) => apiV2.patch(`/meetings/${id}`, body).then((r) => r.data),
  token: (id, body) => apiV2.post(`/meetings/${id}/token`, body).then((r) => r.data),
  hostSessionOpen: (id) => apiV2.post(`/meetings/${id}/host-session-open`, {}).then((r) => r.data),
  listInvites: (id) => apiV2.get(`/meetings/${id}/invites`).then((r) => r.data),
  createInvite: (id, body) => apiV2.post(`/meetings/${id}/invites`, body).then((r) => r.data),
  revokeInvite: (id, linkId) => apiV2.delete(`/meetings/${id}/invites/${encodeURIComponent(linkId)}`).then((r) => r.data),
};

export const v2Host = {
  participants: (meetingId) => apiV2.get(`/host/meetings/${meetingId}/participants`).then((r) => r.data),
  removeParticipant: (meetingId, identity) =>
    apiV2.post(`/host/meetings/${meetingId}/participants/${encodeURIComponent(identity)}/remove`).then((r) => r.data),
  muteParticipant: (meetingId, identity) =>
    apiV2.post(`/host/meetings/${meetingId}/participants/${encodeURIComponent(identity)}/mute`, {}).then((r) => r.data),
  muteAll: (meetingId, exceptIdentity) =>
    apiV2
      .post(`/host/meetings/${meetingId}/participants/mute-all`, exceptIdentity ? { exceptIdentity } : {})
      .then((r) => r.data),
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

export default apiV2;
