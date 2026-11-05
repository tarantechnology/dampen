/**
 * Dampen — system audio capture (architecture Path B).
 *
 * The headline path: Spotify desktop → a virtual audio device (BlackHole,
 * VB-Cable, Loopback, …) → `getUserMedia({ audio: { deviceId } })` → the full
 * Dampen chain → speakers. No DRM is involved because we never touch
 * Spotify's protected stream, only the audio the OS has already decoded.
 *
 * ## No audio is recorded, uploaded or persisted
 *
 * This is a hard product constraint. Nothing in this file writes to disk, to
 * `IndexedDB`, or to the network. The `MediaStream` is handed straight to the
 * engine, which holds it in memory only, and whose `dispose()` stops its
 * tracks.
 *
 * ## Constraints that matter
 *
 * `echoCancellation`, `noiseSuppression` and `autoGainControl` all default to
 * *on* for audio capture in Chrome, because the API was designed for voice
 * calls. On music they are catastrophic: AEC applies a nonlinear adaptive
 * filter keyed to the speaker output (which, on a loopback device, *is* the
 * input — so it tries to cancel the music), NS gates and spectrally subtracts
 * anything it decides is stationary (sustained notes, cymbals, reverb tails),
 * and AGC rides the level. All three are explicitly disabled.
 */

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface CaptureDevice {
  deviceId: string;
  label: string;
  likelyVirtual: boolean;
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
    // `cause` is standard but assigning it through the options bag is not
    // supported in every target we compile for, so set it explicitly.
    if (options && 'cause' in options) this.cause = options.cause;
  }
}

/**
 * Labels that identify a device as a virtual/loopback endpoint rather than a
 * physical microphone. Matching one of these is the strongest hint we can give
 * the user about which input is the one carrying their music.
 */
export const VIRTUAL_DEVICE_PATTERN =
  /blackhole|vb-?cable|vb-?audio|loopback|soundflower|virtual|aggregate|multi-output|voicemeeter/i;

/** True if the device label looks like a virtual audio cable. */
export function isLikelyVirtual(label: string): boolean {
  return VIRTUAL_DEVICE_PATTERN.test(label);
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
 *
 * The names are the spec's; the aliases are legacy spellings that Chrome and
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

function messageFor(code: CaptureErrorCode, deviceId?: string): string {
  switch (code) {
    case 'permission-denied':
      return 'Microphone access was denied. Dampen needs it to read the virtual audio device — the audio is processed locally and never recorded or uploaded.';
    case 'no-device':
      return deviceId
        ? `Audio input "${deviceId}" no longer exists. It may have been unplugged or the virtual device removed.`
        : 'No audio input devices were found. Install a virtual audio device (BlackHole, VB-Cable or Loopback) to capture system audio.';
    case 'device-in-use':
      return 'That audio device is already in exclusive use by another application.';
    case 'constraints-unsatisfiable':
      return 'That device cannot provide a usable audio stream.';
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
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Enumerate audio inputs, flagging the ones that look like virtual cables.
 *
 * ### The labels problem
 *
 * `enumerateDevices()` returns entries with **empty `label` and empty
 * `deviceId`** until the origin has been granted microphone permission at
 * least once. That is a deliberate fingerprinting defence, and it means a
 * naive device picker shows a list of blanks. So:
 *
 *  1. enumerate;
 *  2. if nothing has a usable label, call `getUserMedia({audio:true})` purely
 *     to trigger the permission prompt, then stop the tracks immediately;
 *  3. enumerate again — now the labels are populated.
 *
 * Step 2 is skipped entirely when labels are already available, so a returning
 * user never sees a second prompt.
 *
 * @throws {CaptureError} `'unsupported'` if `mediaDevices` is missing, or
 *         `'permission-denied'` if the probe was refused (in which case a
 *         usable list cannot be built at all, so reporting it is more useful
 *         than returning a list of blanks).
 */
export async function listCaptureDevices(): Promise<CaptureDevice[]> {
  const devices = mediaDevices();

  const read = async (): Promise<MediaDeviceInfo[]> => {
    const all = await devices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  };

  let inputs = await read();
  const hasLabels = inputs.some((d) => d.label.length > 0 && d.deviceId.length > 0);

  if (!hasLabels) {
    try {
      await probePermission(devices);
    } catch (err) {
      const code = classify(err);
      // `no-device` here is genuinely "there is nothing to capture", which is
      // an empty list rather than an error.
      if (code === 'no-device') return [];
      throw new CaptureError(code, messageFor(code), { cause: err });
    }
    inputs = await read();
  }

  return inputs
    .filter((d) => d.deviceId.length > 0)
    .map((d) => ({
      deviceId: d.deviceId,
      // Chrome returns 'default' and 'communications' pseudo-devices with
      // prefixed labels; keep them, they are legitimately selectable.
      label: d.label || `Audio input ${d.deviceId.slice(0, 6)}`,
      likelyVirtual: isLikelyVirtual(d.label),
    }))
    // Virtual devices first: on a machine with BlackHole installed, that is
    // almost certainly the one the user wants.
    .sort((a, b) => Number(b.likelyVirtual) - Number(a.likelyVirtual));
}

/**
 * Open a capture stream for a specific device.
 *
 * `deviceId` is requested with `{ exact: ... }` so that a missing device is a
 * loud `OverconstrainedError` rather than a silent fallback to the built-in
 * microphone — capturing the room instead of the music would be a baffling
 * failure to debug by ear.
 *
 * @param deviceId from {@link listCaptureDevices}; an empty string requests
 *                 the system default input.
 * @throws {CaptureError} always typed; never a bare string or a raw DOMException.
 */
export async function openCapture(deviceId: string): Promise<MediaStream> {
  const devices = mediaDevices();

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

  try {
    const stream = await devices.getUserMedia({ audio, video: false });
    if (stream.getAudioTracks().length === 0) {
      for (const t of stream.getTracks()) t.stop();
      throw new CaptureError('no-device', messageFor('no-device', deviceId));
    }
    return stream;
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    const code = classify(err);
    throw new CaptureError(code, messageFor(code, deviceId), { cause: err });
  }
}

/**
 * Best-effort guess at the device the user most likely wants: the first
 * virtual cable, or `null` if none is installed.
 */
export function pickLikelyDevice(devices: readonly CaptureDevice[]): CaptureDevice | null {
  return devices.find((d) => d.likelyVirtual) ?? null;
}
