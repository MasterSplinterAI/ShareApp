/** Shared camera / screen-share publish settings for LiveKitRoom and preview-track publish. */
export const ROOM_PUBLISH_DEFAULTS = {
  videoSimulcastLayers: [
    { width: 320, height: 180, encoding: { maxBitrate: 150_000, maxFramerate: 15 } },
    { width: 640, height: 360, encoding: { maxBitrate: 500_000, maxFramerate: 30 } },
    { width: 1280, height: 720, encoding: { maxBitrate: 1_700_000, maxFramerate: 30 } },
  ],
  screenShareEncoding: {
    maxBitrate: 3_000_000,
    maxFramerate: 15,
  },
  screenShareSimulcastLayers: [
    { width: 1280, height: 720, encoding: { maxBitrate: 1_500_000, maxFramerate: 15 } },
    { width: 1920, height: 1080, encoding: { maxBitrate: 3_000_000, maxFramerate: 15 } },
  ],
  videoCodec: 'vp9',
};
