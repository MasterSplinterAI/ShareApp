/**
 * Parse meeting ID and parameters from URL
 */

export const parseMeetingUrl = (url) => {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    // Look for /join/:meetingId pattern
    const joinIndex = pathParts.indexOf('join');
    if (joinIndex !== -1 && pathParts[joinIndex + 1]) {
      return {
        meetingId: pathParts[joinIndex + 1],
        name: urlObj.searchParams.get('name') || null,
        code: urlObj.searchParams.get('code') || null,
      };
    }
    
    // Look for /host/:meetingId pattern
    const hostIndex = pathParts.indexOf('host');
    if (hostIndex !== -1 && pathParts[hostIndex + 1]) {
      return {
        meetingId: pathParts[hostIndex + 1],
        isHost: true,
        code: urlObj.searchParams.get('code') || null,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing URL:', error);
    return null;
  }
};

export const getMeetingIdFromUrl = () => {
  const parsed = parseMeetingUrl(window.location.href);
  return parsed?.meetingId || null;
};

export const buildMeetingUrl = (meetingId, options = {}) => {
  const baseUrl = window.location.origin;
  const { isHost = false, name = null, code = null } = options;
  
  const path = isHost ? `/host/${meetingId}` : `/join/${meetingId}`;
  const url = new URL(path, baseUrl);
  
  if (name) {
    url.searchParams.set('name', name);
  }
  if (code) {
    url.searchParams.set('code', code);
  }
  
  return url.toString();
};

export const updateUrl = (meetingId, options = {}) => {
  const url = buildMeetingUrl(meetingId, options);
  window.history.pushState({}, '', url);
};

