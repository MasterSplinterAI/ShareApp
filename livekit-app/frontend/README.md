# LiveKit Frontend

React + Vite frontend for the ShareApp live-translation conference.

## Screen-Share `publishDefaults` — DO NOT REVERT

Introduced in commit `8aa64c9`. These settings are intentional and load-bearing for screen-share quality.

```js
publishDefaults: {
  // Camera: 3-layer simulcast for graceful degradation on low-bandwidth viewers
  videoSimulcastLayers: [
    { width: 320,  height: 180,  encoding: { maxBitrate: 150_000,  maxFramerate: 15 } },
    { width: 640,  height: 360,  encoding: { maxBitrate: 500_000,  maxFramerate: 30 } },
    { width: 1280, height: 720,  encoding: { maxBitrate: 1_700_000, maxFramerate: 30 } },
  ],
  // Screen share: prioritize clarity over motion (code/docs/designs need sharpness, not 60fps)
  screenShareEncoding: {
    maxBitrate: 3_000_000,
    maxFramerate: 15,
  },
  // Screen share simulcast: 2 layers so 720p viewers don't drop the full 1080p stream
  screenShareSimulcastLayers: [
    { width: 1280, height: 720,  encoding: { maxBitrate: 1_500_000, maxFramerate: 15 } },
    { width: 1920, height: 1080, encoding: { maxBitrate: 3_000_000, maxFramerate: 15 } },
  ],
  // VP9 for cameras — ~30% better quality at same bitrate vs VP8/H264
  videoCodec: 'vp9',
}
```

### Rationale

- **Clarity over motion**: ShareApp is used for metals trading discussions with screen-shared spreadsheets, PDFs, and charts. Text legibility matters more than smooth motion — 15fps is adequate.
- **3 Mbps cap + 2-layer simulcast**: Receivers subscribe to the highest layer their bandwidth supports. Without simulcast, a single 1080p stream would degrade for all viewers simultaneously. With two layers (720p + 1080p), each viewer gets the best quality their link can handle.
- **VP9**: Significantly better compression than VP8 at the same bitrate, especially for screen content with flat regions and sharp text.
- **Camera simulcast**: 3 layers (180p/360p/720p) keeps camera tiles smooth for participants on constrained links while giving full-quality views to those on good connections.

### What breaks if you revert

- Reverting `screenShareSimulcastLayers` removes the 720p fallback. Viewers on slower connections will see the full-resolution stream skip frames or drop entirely.
- Removing `videoCodec: 'vp9'` causes Safari/older Chrome to negotiate VP8, wasting ~30% of bitrate budget.
- Removing `screenShareEncoding` uncaps the bitrate, potentially saturating upload links and causing audio degradation.

## Development

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # production build
npm run lint     # ESLint (0 warnings allowed)
```

## Environment Variables

```
VITE_API_URL=http://localhost:3001/api
VITE_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
```
