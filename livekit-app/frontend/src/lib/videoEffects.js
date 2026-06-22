/**
 * Camera background effects (blur / virtual backgrounds) built on
 * @livekit/track-processors.
 *
 * The processors package (MediaPipe segmentation) is heavy, so it is loaded with a
 * dynamic import — the chunk downloads once, on the prejoin/meeting screens, never
 * on marketing or dashboard pages.
 *
 * Lifecycle model (per the processor docs): attach ONE BackgroundProcessor per
 * LocalVideoTrack, initialized in 'disabled' mode, then `switchTo()` the desired
 * effect. switchTo avoids the visual artifacts that repeated
 * setProcessor/stopProcessor cycles produce. LiveKit creates a NEW LocalVideoTrack
 * whenever the camera is re-enabled or the device changes, so callers re-run
 * applyVideoEffect on every track instance; the WeakMap keeps one processor per track.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'parley_video_effect';
const MOBILE_MAX_WIDTH = 640;

export const VIDEO_EFFECTS = [
  { id: 'none', label: 'None', kind: 'none' },
  { id: 'blur', label: 'Blur', kind: 'blur', blurRadius: 10 },
  { id: 'blur-strong', label: 'Strong blur', kind: 'blur', blurRadius: 22 },
  {
    id: 'bg-office',
    label: 'Office',
    kind: 'image',
    imagePath: '/backgrounds/bg-office.jpg',
  },
  {
    id: 'bg-bookshelf',
    label: 'Bookshelf',
    kind: 'image',
    imagePath: '/backgrounds/bg-bookshelf.jpg',
  },
  {
    id: 'bg-conference',
    label: 'Conference room',
    kind: 'image',
    imagePath: '/backgrounds/bg-conference.jpg',
  },
  {
    id: 'bg-loft',
    label: 'Loft',
    kind: 'image',
    imagePath: '/backgrounds/bg-loft.jpg',
  },
  {
    id: 'bg-cafe',
    label: 'Café',
    kind: 'image',
    imagePath: '/backgrounds/bg-cafe.jpg',
  },
  {
    id: 'bg-skyline',
    label: 'Skyline',
    kind: 'image',
    imagePath: '/backgrounds/bg-skyline.jpg',
  },
  {
    id: 'bg-beach',
    label: 'Beach',
    kind: 'image',
    imagePath: '/backgrounds/bg-beach.jpg',
  },
  {
    id: 'bg-gradient',
    label: 'Gradient',
    kind: 'image',
    imagePath: '/backgrounds/bg-gradient.jpg',
  },
];

export function getEffectById(id) {
  return VIDEO_EFFECTS.find((e) => e.id === id) || VIDEO_EFFECTS[0];
}

let modulePromise = null;
function loadProcessorsModule() {
  if (!modulePromise) {
    modulePromise = import('@livekit/track-processors');
  }
  return modulePromise;
}

let cachedSupport = null;
let cachedBrowserSupport = null;

function hasBackgroundProcessorBrowserSupport() {
  if (cachedBrowserSupport !== null) return cachedBrowserSupport;
  let gl = null;
  try {
    gl = document.createElement('canvas').getContext('webgl2');
  } catch {
    gl = null;
  }
  cachedBrowserSupport = Boolean(
    typeof OffscreenCanvas !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      typeof createImageBitmap !== 'undefined' &&
      gl
  );
  gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  return cachedBrowserSupport;
}

/** Segmentation runs on WebGL/WASM — old Safari and some WebViews lack support. */
export async function checkVideoEffectsSupport() {
  if (cachedSupport !== null) return cachedSupport;
  if (!hasBackgroundProcessorBrowserSupport()) {
    cachedSupport = false;
    return cachedSupport;
  }
  try {
    const mod = await loadProcessorsModule();
    cachedSupport = Boolean(mod.supportsBackgroundProcessors());
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

/** React gate for effects UI; false until the (lazy) support check resolves. */
export function useVideoEffectsSupport() {
  const [supported, setSupported] = useState(
    cachedSupport === true || (cachedSupport === null && hasBackgroundProcessorBrowserSupport())
  );
  useEffect(() => {
    if (cachedSupport === null && !hasBackgroundProcessorBrowserSupport()) {
      cachedSupport = false;
      setSupported(false);
    }
  }, []);
  return supported;
}

export function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_MAX_WIDTH;
}

/** Matches meeting layout mobile breakpoint (VideoGrid, control bar compact mode). */
export function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  useEffect(() => {
    const check = () => setIsMobile(isMobileViewport());
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

/** Browser support plus non-mobile viewport — use to gate effects UI and application. */
export function useVideoEffectsAvailable() {
  const supported = useVideoEffectsSupport();
  const isMobile = useIsMobileViewport();
  return supported && !isMobile;
}

export function loadSavedEffectId() {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id && VIDEO_EFFECTS.some((e) => e.id === id) ? id : 'none';
  } catch {
    return 'none';
  }
}

export function saveEffectId(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable — effect just won't persist */
  }
}

function effectToProcessorOptions(effect) {
  if (effect.kind === 'blur') {
    return { mode: 'background-blur', blurRadius: effect.blurRadius };
  }
  if (effect.kind === 'image') {
    // VirtualBackground needs an absolute URL when the page is served from a sub-path.
    const url = new URL(effect.imagePath, window.location.origin).toString();
    return { mode: 'virtual-background', imagePath: url };
  }
  return { mode: 'disabled' };
}

// One processor per LocalVideoTrack. WeakMap so destroyed tracks release theirs.
const processorByTrack = new WeakMap();
// Serialize switches per track — overlapping switchTo calls race inside the pipeline.
const pendingByTrack = new WeakMap();

/**
 * Pick the segmentation model that matches the camera's actual framing.
 * The landscape model (256×144) is trained for 16:9 desktop webcams; feeding it
 * portrait phone frames squashes the person and shreds the mask edges. Portrait
 * (and unknown) framing uses the square general model (256×256) instead.
 */
function pickModelPath(track) {
  let landscape = false;
  try {
    const s = track?.mediaStreamTrack?.getSettings?.() || {};
    if (s.width && s.height) landscape = s.width > s.height;
  } catch {
    /* settings unavailable — fall through to the square model */
  }
  return landscape
    ? '/mediapipe/selfie_segmenter_landscape.tflite'
    : '/mediapipe/selfie_segmenter.tflite';
}

/**
 * Ensure `track` renders with the given effect id. Safe to call repeatedly and on
 * fresh tracks (camera re-enable, device switch). Resolves when the switch lands.
 */
export async function applyVideoEffect(track, effectId) {
  if (!track || track.isDisposed) return;
  if (isMobileViewport()) {
    effectId = 'none';
  }
  const effect = getEffectById(effectId);

  const run = async () => {
    if (effect.kind === 'none' && !processorByTrack.has(track)) return;
    if (!(await checkVideoEffectsSupport())) return;
    const { BackgroundProcessor } = await loadProcessorsModule();
    let processor = processorByTrack.get(track);
    if (!processor) {
      // No effect wanted and none attached — skip creating the pipeline entirely
      // (saves GPU on participants who never touch effects).
      if (effect.kind === 'none') return;
      processor = BackgroundProcessor({
        mode: 'disabled',
        // Self-hosted MediaPipe assets (no third-party CDN at call time, works on
        // restricted enterprise networks). Model is chosen per track: landscape
        // (256×144) for 16:9 desktop webcams, square (256×256) for portrait phone
        // cameras — using the wrong aspect noticeably degrades mask edges.
        assetPaths: {
          tasksVisionFileSet: new URL('/mediapipe/wasm', window.location.origin).toString(),
          modelAssetPath: new URL(pickModelPath(track), window.location.origin).toString(),
        },
      });
      processorByTrack.set(track, processor);
      await track.setProcessor(processor);
    }
    await processor.switchTo(effectToProcessorOptions(effect));
  };

  const prev = pendingByTrack.get(track) || Promise.resolve();
  const next = prev.catch(() => {}).then(run);
  pendingByTrack.set(track, next);
  return next;
}
