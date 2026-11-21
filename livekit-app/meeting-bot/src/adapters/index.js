'use strict';

const { GoogleMeetAdapter } = require('./googleMeetAdapter');
const { MicrosoftTeamsAdapter } = require('./microsoftTeamsAdapter');

const ADAPTERS = {
  google_meet: GoogleMeetAdapter,
  ms_teams: MicrosoftTeamsAdapter,
};

function getAdapterForPlatform(platform) {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new Error(`Unsupported external meeting platform: ${platform}`);
  }
  return adapter;
}

module.exports = {
  ADAPTERS,
  getAdapterForPlatform,
};
