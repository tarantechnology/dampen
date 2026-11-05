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

/**
 * An audio **output** endpoint.
 *
 * The output side matters as much as the input on macOS, and for a reason that
 * is not obvious: the Spotify desktop app has no per-application output
 * picker, so it follows the **system default output**. Routing Spotify into
 * BlackHole therefore means setting the *system* default to BlackHole — at
 * which point Chrome's own output goes there too, the user hears nothing, and
 * Dampen's output lands straight back in its own input. Path B is unusable
 * until the page picks its output explicitly (see `setOutputDevice` in
 * `engine.ts`).
 */
export interface OutputDevice {
  /** `'default'` is Chrome's pseudo-device meaning "follow the system". */
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
  passthrough: CapturePassthrough;
  groupId: string;
  /** True for the `'default'` pseudo-device. */
  isDefault: boolean;
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
 * Do these two endpoints refer to the same piece of hardware?
 *
 * `groupId` is the spec's answer and the one to trust: the input and output
 * halves of one device get different `deviceId`s but share a group. It can be
 * empty before permission is granted, though, so the label is a fallback —
 * BlackHole's input and output are both labelled "BlackHole 2ch", which is
 * exactly the case that matters here.
 */
export function sameHardware(
  a: { groupId: string; label: string },
  b: { groupId: string; label: string },
): boolean {
  if (a.groupId && b.groupId && a.groupId === b.groupId) return true;
  if (!a.label || !b.label) return false;
  // Chrome prefixes the default pseudo-device's label ("Default - Speakers").
  const strip = (l: string) => l.replace(/^default\s*[-–]\s*/i, '').trim().toLowerCase();
  return strip(a.label) === strip(b.label);
}

/**
 * Which physical output `'default'` (or an empty selection) actually resolves
 * to.
 *
 * Chrome lists a `'default'` pseudo-device whose `groupId` is that of the real
 * current default, so the real one can be recovered by matching groups. This
 * is what lets the guard catch "capture = BlackHole, output = system default,
 * and the system default *is* BlackHole" — the single most likely real-world
 * footgun on macOS, and one that is invisible if you only look at the
 * selected `deviceId`.
 */
export function resolveSystemDefaultOutput(
  outputs: readonly OutputDevice[],
): OutputDevice | null {
  const pseudo = outputs.find((o) => o.isDefault);
  if (!pseudo) return outputs[0] ?? null;
  const real = outputs.find((o) => !o.isDefault && sameHardware(o, pseudo));
  return real ?? pseudo;
}

/** The output a given selection resolves to. `''`/`'default'` follow the system. */
export function resolveOutput(
  outputs: readonly OutputDevice[],
  selectedId: string,
): OutputDevice | null {
  if (!selectedId || selectedId === 'default') return resolveSystemDefaultOutput(outputs);
  return outputs.find((o) => o.deviceId === selectedId) ?? null;
}

/**
 * Labels that indicate an output the user is actually listening to, as opposed
 * to one that merely exists.
 *
 * This ranking is not cosmetic. On the machine this was developed against,
 * `enumerateDevices` lists `"NZXTCANVAS27Q (HDMI)"` *before*
 * `"MacBook Pro Speakers (Built-in)"`, so "first non-virtual device" would
 * auto-route Dampen to a monitor that may be off or have no speakers at all —
 * and the whole point of the auto-rescue is that the user hears something.
 */
const LISTENING_OUTPUT_PATTERN = /built-?in|internal|speaker|headphone|airpod|earbud|usb audio/i;

/**
 * The best output that is real hardware — built-in speakers, headphones, an
 * interface — skipping virtual sinks and the `'default'` pseudo-device.
 *
 * Used to rescue the user automatically: if they have routed the system
 * default to BlackHole so Spotify feeds Dampen, this is where Dampen should
 * send its own audio.
 *
 * Preference order: the device the system default resolves to (if it is real
 * hardware — the user is demonstrably listening to it), then anything that
 * looks like speakers or headphones, then any other non-virtual output.
 */
export function pickPhysicalOutput(outputs: readonly OutputDevice[]): OutputDevice | null {
  const usable = outputs.filter((o) => !o.isDefault && !o.likelyVirtual && o.deviceId);
  if (usable.length === 0) return null;

  const systemDefault = resolveSystemDefaultOutput(outputs);
  if (systemDefault && !systemDefault.likelyVirtual) {
    const match = usable.find((o) => o.deviceId === systemDefault.deviceId);
    if (match) return match;
  }
  return usable.find((o) => LISTENING_OUTPUT_PATTERN.test(o.label)) ?? usable[0];
}

/**
 * Decide whether capturing `device` while playing out of `selectedOutputId`
 * can produce a doubled or runaway signal.
 *
 * Hazards, in descending severity:
 *
 *  1. **Same physical device.** The chosen input *is* the device we are
 *     playing into — a closed loop, and the only case that can actually howl.
 *     Checked against the output the selection really resolves to, so
 *     "output = system default = BlackHole" is caught.
 *  2. **Passthrough.** No runaway, but the user hears two copies ~8 ms apart.
 *  3. **A real microphone.** Capturing the room while playing through speakers
 *     is acoustic feedback by construction.
 *
 * @param selectedOutputId what the page has asked for via `setSinkId`; `''`
 *                         or `'default'` means it follows the system default.
 */
export function assessFeedbackRisk(
  device: CaptureDevice | null,
  outputs: readonly OutputDevice[] = [],
  selectedOutputId: string = '',
): FeedbackAssessment {
  if (!device) return NO_RISK;

  const live = resolveOutput(outputs, selectedOutputId);

  if (live && sameHardware(device, live)) {
    const followsSystem = !selectedOutputId || selectedOutputId === 'default';
    return {
      risk: true,
      reason: 'same-device',
      message: followsSystem
        ? `Dampen is playing out of "${live.label}", which is also the input it is capturing — so its own output is fed straight back in. Pick a real output device (your speakers or headphones) for Dampen; the system default can stay on "${live.label}" so Spotify keeps feeding it.`
        : `The selected input and output are the same device ("${live.label}"), so Dampen would capture its own output. Choose a different one.`,
    };
  }

  // No usable output list: fall back to the conservative group check, which is
  // all we could do before the output side was selectable.
  if (!live && device.groupId && outputs.some((o) => o.groupId === device.groupId)) {
    return {
      risk: true,
      reason: 'same-device',
      message:
        'This input belongs to the same device Dampen is playing out of, so its output would be captured again and build up. Choose a different input or a different output.',
    };
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

function toOutputDevice(d: MediaDeviceInfo): OutputDevice {
  const isDefault = d.deviceId === 'default';
  const described = describeDevice(d.label);
  return {
    deviceId: d.deviceId,
    label: d.label || (isDefault ? 'System default' : `Audio output ${d.deviceId.slice(0, 6)}`),
    likelyVirtual: isLikelyVirtual(d.label),
    passthrough: described.passthrough,
    groupId: d.groupId,
    isDefault,
    note: described.note,
  };
}

/**
 * Enumerate audio **outputs**, so the page can choose where Dampen plays.
 *
 * Mirrors {@link listCaptureDevices}, including the labels problem — but the
 * output side is stricter, and this was measured rather than assumed.
 *
 * **Verified in Chrome 156 (macOS):** with no media permission grant,
 * `enumerateDevices()` returns exactly **one** `audiooutput` entry, and it has
 * an empty `deviceId`, an empty `groupId` and an empty `label`. So without the
 * grant there is nothing nameable to select at all — `setSinkId` is not
 * refused, there is simply no device id to pass it. After the grant the full
 * list appears with real ids. Hence: **request capture permission first, then
 * choose an output.** Blank entries are dropped here so the picker shows an
 * empty list (and the UI can say why) rather than a nameless placeholder.
 *
 * The probe is the *same* microphone prompt — there is no separate "speaker
 * permission" — so it is skipped by default (`probePermission` is `false`) on
 * the assumption that the capture flow has already asked, or is about to.
 * Pass `{ probePermission: true }` only from a user gesture.
 *
 * Physical devices are listed before virtual ones, because when the system
 * default has been pointed at BlackHole the thing the user wants for Dampen's
 * output is their actual speakers.
 */
export async function listOutputDevices(
  options: { probePermission?: boolean } = {},
): Promise<OutputDevice[]> {
  const devices = mediaDevices();

  const read = async (): Promise<MediaDeviceInfo[]> => {
    const all = await devices.enumerateDevices();
    return all.filter((d) => d.kind === 'audiooutput');
  };

  let outs = await read();
  const hasLabels = outs.some((d) => d.label.length > 0);
  if (!hasLabels && (options.probePermission ?? false)) {
    try {
      await probePermission(devices);
    } catch {
      // A denied probe still leaves a usable (if unlabelled) list; the caller
      // will have been told about the denial by the capture flow.
    }
    outs = await read();
  }

  const rank = (o: OutputDevice): number => {
    if (o.isDefault) return 1; // useful to offer, but not the thing to auto-pick
    return o.likelyVirtual ? 2 : 0;
  };
  return outs
    .filter((d) => d.deviceId.length > 0)
    .map(toOutputDevice)
    .sort((a, b) => rank(a) - rank(b));
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
