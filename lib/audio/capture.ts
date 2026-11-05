/**
 * Dampen — system audio capture (architecture Path B, the primary path).
 *
 * Spotify desktop → a virtual audio device → `getUserMedia({audio:{deviceId}})`
 * → the full Dampen chain → speakers. No DRM is involved because we never
 * touch Spotify's protected stream, only audio the OS has already decoded.
 *
 * ## No audio is recorded, uploaded or persisted
 *
 * A hard product constraint. Nothing in this file writes to disk, to
 * `IndexedDB`, or to the network. The `MediaStream` goes straight to the
 * engine, which holds it in memory only and stops its tracks on `dispose()`.
 *
 * ## The two things that make or break this path
 *
 * **1. Passthrough.** Virtual audio devices come in two flavours and they
 * sound completely different in this application:
 *
 *  - A **pure sink** (BlackHole, VB-Cable) swallows what is routed into it.
 *    Spotify → BlackHole is *silent* at the speakers, so Dampen's processed
 *    output is the only sound in the room. This is what you want.
 *  - A **passthrough** device (Background Music, Loopback with "mute when
 *    capturing" off, an Aggregate/Multi-Output that includes the real output)
 *    also forwards the audio to the physical output. The listener then hears
 *    raw Spotify *and* Dampen's version a few milliseconds later. Two
 *    correlated copies a few ms apart is a comb filter — a hollow, phasey,
 *    "broken" sound that users will blame on the DSP. It is not fixable from
 *    inside the browser; the user must mute the passthrough.
 *
 * So {@link CaptureDevice.passthrough} is acoustically load-bearing, not
 * trivia, and {@link CAPTURE_DEVICE_NOTES} exists so the UI can say *what to
 * do about it* rather than just flagging a warning.
 *
 * **2. Sample rate.** See {@link preferredContextSampleRate}.
 *
 * ## Constraints that matter
 *
 * `echoCancellation`, `noiseSuppression` and `autoGainControl` all default to
 * *on* for audio capture in Chrome, because the API was designed for voice
 * calls. On music they are catastrophic: AEC applies a nonlinear adaptive
 * filter keyed to the speaker output (which, on a loopback device, *is* the
 * input — so it tries to cancel the music), NS gates and spectrally subtracts
 * anything it decides is stationary (sustained notes, cymbals, reverb tails),
 * and AGC rides the level. All three are explicitly disabled, always.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/**
 * Whether a device forwards the audio routed into it to the real output as
 * well as to us.
 *
 *  - `'none'`    — a pure sink. Routing Spotify into it silences the speakers,
 *                  so Dampen's output is the only thing audible. Ideal.
 *  - `'likely'`  — it also plays the audio through. The user will hear raw
 *                  Spotify *and* Dampen's output a few ms apart: comb
 *                  filtering. The UI must warn and tell them to mute it.
 *  - `'unknown'` — an unrecognised device, or a real microphone.
 */
export type CapturePassthrough = 'none' | 'likely' | 'unknown';

export interface CaptureDevice {
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
  /** See {@link CapturePassthrough}. Additive to the API contract. */
  passthrough: CapturePassthrough;
  /**
   * `groupId` from `MediaDeviceInfo`. Shared by the input and output halves of
   * the same physical device, which is how {@link assessFeedbackRisk} can tell
   * that capturing this input means capturing our own output.
   */
  groupId: string;
  /** A short, user-facing note about this device, if we recognise it. */
  note?: string;
}

/** The real, negotiated properties of an open capture stream. */
export interface CaptureStreamSettings {
  /** Hz, from `track.getSettings()`. `null` when the browser does not report it. */
  sampleRate: number | null;
  /** 1 or 2 in practice. `null` when unreported. */
  channelCount: number | null;
  /** The device actually granted, which may differ from the one requested. */
  deviceId: string | null;
  label: string;
  /** Round-trip latency hint in seconds, if the browser reports one. */
  latency: number | null;
}

export interface CaptureOpenResult {
  stream: MediaStream;
  settings: CaptureStreamSettings;
}

export type CaptureErrorCode =
  /** `navigator.mediaDevices` is missing — insecure context, or a very old browser. */
  | 'unsupported'
  /** The user (or a policy) refused microphone access. */
  | 'permission-denied'
  /** No audio input exists, or the requested `deviceId` is gone. */
  | 'no-device'
  /** The OS or another app has exclusive use of the device. */
  | 'device-in-use'
  /** The requested constraints cannot be satisfied by that device. */
  | 'constraints-unsatisfiable'
  /** The device disappeared while we were using it (unplugged, driver removed). */
  | 'device-lost'
  | 'unknown';

/**
 * A typed error, so callers can branch on `err.code` and show the right
 * remedy ("grant access", "install BlackHole", "close the other app") instead
 * of pattern-matching on message strings.
 */
export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    // `cause` through the options bag is not supported on every target we
    // compile for, so set it explicitly.
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

/* ------------------------------------------------------------------ *
 * Device recognition
 * ------------------------------------------------------------------ */

/**
 * Labels that identify a device as a virtual/loopback endpoint rather than a
 * physical microphone. Matching one is the strongest hint we can give the user
 * about which input carries their music.
 */
export const VIRTUAL_DEVICE_PATTERN =
  /blackhole|vb-?cable|vb-?audio|loopback|soundflower|background music|virtual|aggregate|multi-?output|voicemeeter|pipewire|pulse|null sink|existential audio/i;

/** True if the device label looks like a virtual audio cable. */
export function isLikelyVirtual(label: string): boolean {
  return VIRTUAL_DEVICE_PATTERN.test(label);
}

interface DeviceProfile {
  readonly match: RegExp;
  readonly passthrough: CapturePassthrough;
  readonly note: string;
}

/**
 * What we know about the devices people actually have installed, in priority
 * order (first match wins).
 *
 * The `passthrough` classification is the important column — see the file
 * header for why. The notes are written to be shown verbatim in the UI.
 */
const DEVICE_PROFILES: readonly DeviceProfile[] = [
  {
    // Existential Audio BlackHole. The ideal device: a pure virtual sink with
    // no path to the physical output.
    match: /blackhole|existential audio/i,
    passthrough: 'none',
    note: 'Ideal. BlackHole is a pure sink, so routing Spotify into it silences your speakers and Dampen becomes the only sound.',
  },
  {
    // VB-Audio VB-Cable / Voicemeeter virtual cables: also pure sinks.
    match: /vb-?cable|vb-?audio|voicemeeter/i,
    passthrough: 'none',
    note: 'Pure virtual cable — Spotify routed into it is silent at the speakers, which is exactly what Dampen wants.',
  },
  {
    // kyleneideck/BackgroundMusic. By design it plays audio through to the
    // real output device while also exposing it for capture.
    match: /background music/i,
    passthrough: 'likely',
    note: 'Background Music passes audio through to your speakers as well as to Dampen, so you will hear the original and the dampened version a few milliseconds apart (a hollow, phasey comb filter). Mute the real output, or use BlackHole instead.',
  },
  {
    // Rogue Amoeba Loopback: pass-thru monitoring is on by default.
    match: /loopback/i,
    passthrough: 'likely',
    note: 'Loopback monitors to your output by default, so you may hear Spotify twice. Turn off its monitoring, or route Spotify to a device with no passthrough.',
  },
  {
    // A macOS Aggregate or Multi-Output device by definition includes the real
    // output alongside the virtual one.
    match: /aggregate|multi-?output/i,
    passthrough: 'likely',
    note: 'Aggregate and Multi-Output devices include your real speakers, so the original audio keeps playing alongside Dampen. Expect comb filtering unless you remove the physical output from the aggregate.',
  },
  {
    // Meeting apps install capture devices that are *not* system taps: they
    // only carry that app's own audio, so they will be silent for Spotify.
    match: /zoom|loom|teams|webex|discord|krisp/i,
    passthrough: 'unknown',
    note: 'This is a meeting app’s own virtual device, not a system audio tap. It will almost certainly be silent — it only carries that app’s audio.',
  },
  {
    match: /soundflower/i,
    passthrough: 'none',
    note: 'Soundflower is a pure sink, but it is long unmaintained; BlackHole is its supported successor.',
  },
  {
    match: /pipewire|pulse|null sink/i,
    passthrough: 'unknown',
    note: 'A PipeWire/PulseAudio node. Whether it passes audio through depends on how you wired it.',
  },
];

/** Classification plus advice for a device label, if we recognise it. */
export function describeDevice(label: string): {
  passthrough: CapturePassthrough;
  note?: string;
} {
  for (const p of DEVICE_PROFILES) {
    if (p.match.test(label)) return { passthrough: p.passthrough, note: p.note };
  }
  return { passthrough: 'unknown' };
}

/**
 * Advice keyed by a stable id, so the UI can render the same guidance it would
 * get from {@link describeDevice} without re-running the regexes — and can
 * show the "you have nothing installed" case too.
 */
export const CAPTURE_DEVICE_NOTES: Readonly<Record<string, string>> = {
  blackhole: DEVICE_PROFILES[0].note,
  'vb-cable': DEVICE_PROFILES[1].note,
  'background-music': DEVICE_PROFILES[2].note,
  loopback: DEVICE_PROFILES[3].note,
  aggregate: DEVICE_PROFILES[4].note,
  'meeting-app': DEVICE_PROFILES[5].note,
  soundflower: DEVICE_PROFILES[6].note,
  pipewire: DEVICE_PROFILES[7].note,
  'none-installed':
    'No virtual audio device found. Install BlackHole (free, macOS) or VB-Cable (Windows), then set Spotify’s output to it so Dampen can read the audio.',
  microphone:
    'This looks like a real microphone. It will capture the room, not Spotify — and pointing it at your speakers will feed back.',
} as const;

/* ------------------------------------------------------------------ *
 * Feedback risk
 * ------------------------------------------------------------------ */

export interface FeedbackAssessment {
  /** True if starting audio from this device could double or feed back. */
  risk: boolean;
  /** `'passthrough'`, `'same-device'`, `'microphone'` or `'none'`. */
  reason: 'none' | 'passthrough' | 'same-device' | 'microphone';
  /** User-facing explanation; empty when `risk` is false. */
  message: string;
}

const NO_RISK: FeedbackAssessment = { risk: false, reason: 'none', message: '' };

/**
 * Decide whether capturing `device` while playing out through `outputs` can
 * produce a doubled or runaway signal.
 *
 * Three distinct hazards, in descending severity:
 *
 *  1. **Same physical device.** If the chosen input shares a `groupId` with an
 *     audio *output*, we are very likely capturing the thing we are playing
 *     into — a closed loop, and the only case that can actually howl.
 *     `groupId` is the right signal here: `deviceId`s differ between the input
 *     and output halves of one device, but the group is shared by spec.
 *  2. **Passthrough.** No runaway, but the user hears two copies ~8 ms apart.
 *  3. **A real microphone.** Capturing the room while playing through speakers
 *     is acoustic feedback by construction.
 */
export function assessFeedbackRisk(
  device: CaptureDevice | null,
  outputs: readonly MediaDeviceInfo[] = [],
): FeedbackAssessment {
  if (!device) return NO_RISK;

  if (device.groupId) {
    const shared = outputs.some(
      (o) => o.kind === 'audiooutput' && o.groupId === device.groupId,
    );
    if (shared) {
      return {
        risk: true,
        reason: 'same-device',
        message:
          'This input belongs to the same device Dampen is playing out of, so its output would be captured again and build up. Choose a different input or a different output.',
      };
    }
  }

  if (device.passthrough === 'likely') {
    return {
      risk: true,
      reason: 'passthrough',
      message:
        device.note ??
        'This device also plays audio through to your speakers, so you will hear the original alongside Dampen’s version.',
    };
  }

  if (!device.likelyVirtual) {
    return {
      risk: true,
      reason: 'microphone',
      message: CAPTURE_DEVICE_NOTES.microphone,
    };
  }

  return NO_RISK;
}

/* ------------------------------------------------------------------ *
 * Sample rate
 * ------------------------------------------------------------------ */

/**
 * The sample rate an `AudioContext` should be built at for a given capture
 * stream — and the reasoning, because getting this wrong is a pitch-shift bug
 * that is miserable to diagnose.
 *
 * ### What the platform actually does
 *
 * The Web Audio spec requires `MediaStreamAudioSourceNode` to present its
 * track at the `AudioContext`'s sample rate, resampling if the track's native
 * rate differs. So a 44.1 kHz capture device feeding a 48 kHz context is
 * *specified* to work.
 *
 * In practice that resampler has been the single most persistent source of
 * capture bugs in Chromium: mismatched rates have historically produced
 * pitch/speed errors, periodic clicking, and buffer-drift glitches, and the
 * failure is silent — the audio simply sounds slightly wrong, which people
 * attribute to the effects chain. Even when it is correct, it inserts a
 * resampler into the lowest-latency, most dropout-sensitive part of the graph,
 * which is the opposite of what the capture path wants.
 *
 * ### What we do
 *
 * **Eliminate the mismatch rather than trust the resampler.** Read the track's
 * real rate from `track.getSettings().sampleRate` and construct the
 * `AudioContext` with `{ sampleRate }` set to it. The graph then runs natively
 * at the capture rate and the single unavoidable rate conversion happens at
 * the *output* device boundary, where the browser hands off to CoreAudio /
 * WASAPI — a far better-tested path than the Web Audio resampler.
 *
 * ### Caveat
 *
 * `MediaTrackSettings.sampleRate` is not universally implemented (absent in
 * Safari, long absent in Firefox). When it is missing we return `null` and let
 * the browser pick the context rate, accepting its resampler, because the
 * alternative — guessing — is worse.
 */
export function preferredContextSampleRate(settings: CaptureStreamSettings): number | null {
  const sr = settings.sampleRate;
  if (typeof sr !== 'number' || !Number.isFinite(sr)) return null;
  // Sanity bound: a nonsense value would make `new AudioContext({sampleRate})`
  // throw NotSupportedError and take the whole engine down.
  if (sr < 8000 || sr > 192000) return null;
  return Math.round(sr);
}

/** Read the negotiated properties of an already-open stream. */
export function readCaptureSettings(stream: MediaStream): CaptureStreamSettings {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    return { sampleRate: null, channelCount: null, deviceId: null, label: '', latency: null };
  }
  // `getSettings()` returns only the constrainable properties the browser
  // actually supports, so every field is optional in practice.
  const s = track.getSettings() as MediaTrackSettings & {
    sampleRate?: number;
    channelCount?: number;
    latency?: number;
  };
  const numberOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    sampleRate: numberOrNull(s.sampleRate),
    channelCount: numberOrNull(s.channelCount),
    deviceId: typeof s.deviceId === 'string' && s.deviceId.length > 0 ? s.deviceId : null,
    label: track.label,
    latency: numberOrNull(s.latency),
  };
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

function mediaDevices(): MediaDevices {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new CaptureError(
      'unsupported',
      'Audio capture needs navigator.mediaDevices, which requires a secure context (https or localhost).',
    );
  }
  return navigator.mediaDevices;
}

/**
 * Map a `DOMException` from `getUserMedia` onto a {@link CaptureErrorCode}.
 * The names are the spec's; the aliases are legacy spellings Chrome and
 * Firefox still emit in some versions.
 */
function classify(err: unknown): CaptureErrorCode {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'no-device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'device-in-use';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'constraints-unsatisfiable';
    default:
      return 'unknown';
  }
}

export function captureErrorMessage(code: CaptureErrorCode, deviceId?: string): string {
  switch (code) {
    case 'permission-denied':
      return 'Microphone access was denied. Dampen needs it to read the virtual audio device — the audio is processed locally and never recorded or uploaded.';
    case 'no-device':
      return deviceId
        ? `Audio input "${deviceId}" no longer exists. It may have been unplugged or the virtual device removed.`
        : CAPTURE_DEVICE_NOTES['none-installed'];
    case 'device-in-use':
      return 'That audio device is already in exclusive use by another application.';
    case 'constraints-unsatisfiable':
      return 'That device cannot provide a usable audio stream.';
    case 'device-lost':
      return 'The capture device disappeared. Dampen has muted its output; pick an input again to carry on.';
    case 'unsupported':
      return 'Audio capture is unavailable in this browser.';
    default:
      return 'Could not open the audio input.';
  }
}

/** Open a stream and immediately stop it — used only to unlock device labels. */
async function probePermission(devices: MediaDevices): Promise<void> {
  const stream = await devices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already ended */
    }
  }
}

/* ------------------------------------------------------------------ *
 * Enumeration
 * ------------------------------------------------------------------ */

function toCaptureDevice(d: MediaDeviceInfo): CaptureDevice {
  const label = d.label || `Audio input ${d.deviceId.slice(0, 6)}`;
  const described = describeDevice(d.label);
  return {
    deviceId: d.deviceId,
    label,
    likelyVirtual: isLikelyVirtual(d.label),
    passthrough: described.passthrough,
    groupId: d.groupId,
    note: described.note,
  };
}

/**
 * Enumerate audio inputs, flagging virtual cables and classifying passthrough.
 *
 * ### The labels problem
 *
 * `enumerateDevices()` returns entries with **empty `label` and empty
 * `deviceId`** until the origin has been granted microphone permission at
 * least once — a deliberate fingerprinting defence that would otherwise leave
 * the device picker showing a list of blanks. So:
 *
 *  1. enumerate;
 *  2. if nothing has a usable label, call `getUserMedia({audio:true})` purely
 *     to trigger the permission prompt, then stop the tracks immediately;
 *  3. enumerate again — now the labels are populated.
 *
 * Step 2 is skipped when labels are already available, so a returning user
 * never sees a second prompt — and it can be skipped entirely with
 * `{ probePermission: false }`, which is what the hot-plug listener does:
 * plugging in headphones must never raise a microphone prompt out of nowhere.
 * Call it without options from a user gesture (a "choose input" button), where
 * a prompt is expected.
 *
 * Results are sorted with the most useful device first: pure virtual sinks,
 * then other virtual devices, then everything else.
 *
 * @throws {CaptureError} `'unsupported'` if `mediaDevices` is missing, or
 *         `'permission-denied'` if the probe was refused (in which case a
 *         usable list cannot be built at all, so reporting it is more useful
 *         than returning a list of blanks).
 */
export async function listCaptureDevices(
  options: { probePermission?: boolean } = {},
): Promise<CaptureDevice[]> {
  const devices = mediaDevices();
  const probe = options.probePermission ?? true;

  const read = async (): Promise<MediaDeviceInfo[]> => {
    const all = await devices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  };

  let inputs = await read();
  const hasLabels = inputs.some((d) => d.label.length > 0 && d.deviceId.length > 0);

  if (!hasLabels && probe) {
    try {
      await probePermission(devices);
    } catch (err) {
      const code = classify(err);
      // `no-device` here genuinely means "there is nothing to capture", which
      // is an empty list rather than an error.
      if (code === 'no-device') return [];
      throw new CaptureError(code, captureErrorMessage(code), { cause: err });
    }
    inputs = await read();
  }

  // Rank: pure sinks (what we want) > other virtual > physical.
  const rank = (d: CaptureDevice): number => {
    if (d.likelyVirtual && d.passthrough === 'none') return 0;
    if (d.likelyVirtual && d.passthrough === 'likely') return 1;
    if (d.likelyVirtual) return 2;
    return 3;
  };

  return inputs
    .filter((d) => d.deviceId.length > 0)
    .map(toCaptureDevice)
    .sort((a, b) => rank(a) - rank(b));
}

/** Enumerate audio *outputs*, for {@link assessFeedbackRisk}. */
export async function listOutputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = mediaDevices();
  const all = await devices.enumerateDevices();
  return all.filter((d) => d.kind === 'audiooutput');
}

/**
 * Subscribe to device hot-plug.
 *
 * `devicechange` fires on install, removal, plug and unplug — which for this
 * product is routine, not exotic: the user is very likely to install BlackHole
 * *while Dampen is open*, and the whole point of the picker is to notice.
 *
 * The listener is called with a freshly enumerated list. Enumeration failures
 * are swallowed and reported as an empty list rather than thrown, because this
 * fires from a browser event with nowhere to propagate to.
 *
 * @returns an unsubscribe function. Safe to call twice.
 */
export function onDeviceChange(
  listener: (devices: CaptureDevice[]) => void,
): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => undefined;
  const devices = navigator.mediaDevices;

  let stopped = false;
  const handler = (): void => {
    // Never probe from a hot-plug event: the user did not ask for anything, so
    // a permission prompt here would be unexplained and alarming. An
    // unlabelled list is the honest result until they press the button.
    void listCaptureDevices({ probePermission: false })
      .then((list) => {
        if (!stopped) listener(list);
      })
      .catch(() => {
        if (!stopped) listener([]);
      });
  };

  devices.addEventListener('devicechange', handler);
  return () => {
    stopped = true;
    devices.removeEventListener('devicechange', handler);
  };
}

/* ------------------------------------------------------------------ *
 * Opening a stream
 * ------------------------------------------------------------------ */

function captureConstraints(deviceId: string): MediaTrackConstraints {
  const audio: MediaTrackConstraints = {
    // All three voice-call DSP features off: see the file header.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    // Ask for stereo, but do not insist — plenty of virtual devices are mono,
    // and the M/S width block up-mixes those correctly.
    channelCount: { ideal: 2 },
  };
  if (deviceId) audio.deviceId = { exact: deviceId };

  /*
   * `latency: 0` asks the browser for the smallest capture buffer it can
   * manage. It is a hint (an "ideal" of zero, which no device can meet), not a
   * requirement — expressing it as `exact` would make the whole request fail
   * on every real device. It is also not in TypeScript's
   * `MediaTrackConstraints` even though Chromium implements it, so it is
   * attached through a narrow cast rather than by widening the whole object.
   */
  (audio as MediaTrackConstraints & { latency?: ConstrainDouble }).latency = { ideal: 0 };

  return audio;
}

/**
 * Open a capture stream and report what we actually got.
 *
 * `deviceId` is requested with `{ exact: ... }` so a missing device raises a
 * loud `OverconstrainedError` rather than silently falling back to the
 * built-in microphone — capturing the room instead of the music would be a
 * baffling failure to debug by ear.
 *
 * @param deviceId from {@link listCaptureDevices}; an empty string requests
 *                 the system default input.
 * @throws {CaptureError} always typed; never a bare string or a raw DOMException.
 */
export async function openCaptureWithSettings(deviceId: string): Promise<CaptureOpenResult> {
  const devices = mediaDevices();
  try {
    const stream = await devices.getUserMedia({ audio: captureConstraints(deviceId), video: false });
    if (stream.getAudioTracks().length === 0) {
      for (const t of stream.getTracks()) t.stop();
      throw new CaptureError('no-device', captureErrorMessage('no-device', deviceId));
    }
    return { stream, settings: readCaptureSettings(stream) };
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    const code = classify(err);
    throw new CaptureError(code, captureErrorMessage(code, deviceId), { cause: err });
  }
}

/**
 * Open a capture stream.
 *
 * The signature `docs/API_CONTRACT.md` froze. Prefer
 * {@link openCaptureWithSettings} when you care about the negotiated sample
 * rate and channel count — the engine does, because it builds its
 * `AudioContext` at the stream's native rate (see
 * {@link preferredContextSampleRate}). {@link readCaptureSettings} recovers
 * the same information from a stream opened through this function.
 */
export async function openCapture(deviceId: string): Promise<MediaStream> {
  const { stream } = await openCaptureWithSettings(deviceId);
  return stream;
}

/**
 * Best-effort guess at the device the user most likely wants: a pure virtual
 * sink first, then any virtual device, else `null`.
 */
export function pickLikelyDevice(devices: readonly CaptureDevice[]): CaptureDevice | null {
  return (
    devices.find((d) => d.likelyVirtual && d.passthrough === 'none') ??
    devices.find((d) => d.likelyVirtual) ??
    null
  );
}
