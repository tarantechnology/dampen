<h1 align="center">Dampen</h1>

<p align="center">
  <em>A Spotify player that muffles your music, so it sits behind your attention<br/>
  instead of competing with it.</em>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/EFFECTS_RESEARCH.md">The research</a> ·
  <a href="docs/SPOTIFY_SETUP.md">Spotify setup</a>
</p>

---

You know the problem. You want your own music on while you read, write, or think —
but the song you love is the song that grabs you. A chorus lands, a vocal cuts
through, and your attention is gone.

Dampen puts a wall between you and the music. Your real Spotify library, your real
playlists — low-passed, pushed into the next room, stereo image collapsed, presence
band dipped, transients flattened. Still recognisably your song. No longer competing
for your frontal lobe.

One dial controls how far away the music is.

## What "muffled" actually means

Muffling is not a single low-pass filter. A wall between you and a speaker does five
things at once, and Dampen models all five:

| | What it does | Why it matters |
|---|---|---|
| **Low-pass cascade** | up to 48 dB/oct, down to ~300 Hz | Removes the sibilance and transient detail that trigger orienting responses |
| **Presence dip** | −6 dB around 2.5 kHz | The 1–5 kHz band carries speech intelligibility and attention. Dip it and lyrics stop demanding to be parsed |
| **Width collapse** | M/S matrix toward mono | A wide stereo image reads as *present in the room*; mono reads as *elsewhere* |
| **Short dark reverb** | RT60 ~0.6 s, 18 ms pre-delay | Distance cue. Procedurally synthesised, no IR files shipped |
| **Compression** | 3:1, slow release | Flattens the dynamic jumps that pull focus back |

Plus a **masking bed** — brown noise at around −32 dBFS — which covers what is left
of the presence band. Spectral masking is doing real perceptual work here, not
decoration.

Eight presets ship (local-file paths get the full set): `Next Room`, `Underwater`, `Rainy Window`, `Tape Memory`,
`Library`, `Deep Focus`, `Distant Radio`, `Dream`.

## The interesting constraint

**You cannot filter Spotify's web audio.** Two independent walls, and it is worth being
precise about which one actually stops you:

1. **No DOM handle.** The Web Playback SDK injects a cross-origin iframe from a
   Spotify-controlled origin, and the media element lives inside it. You cannot reach
   `iframe.contentDocument`, so you cannot call `createMediaElementSource()` on it at
   all. ([spotify/web-playback-sdk#105](https://github.com/spotify/web-playback-sdk/issues/105))
2. **CORS silence is normative.** Even with a handle, the Web Audio spec *requires* a
   `MediaElementAudioSourceNode` to output silence for a CORS-cross-origin resource —
   silently, undetectably, irreversibly.
   ([Web Audio API 1.1 §1.22.4](https://www.w3.org/TR/webaudio-1.1/#MediaElementAudioSourceOptions-security))

The widely repeated "DRM zeroes the samples" claim is actually the *weaker* of the
reasons — [EME §7.6](https://www.w3.org/TR/encrypted-media-2/#media-element-restrictions)
only *permits* zeroing, it does not require it, and browsers have differed. Don't build
on it either way.

The SDK's entire DSP surface is `setVolume(0..1)`. That is it. No EQ, no filter, no
sample access, no analyser.

So Dampen has three input paths, all feeding one engine and one UI:

| Path | Source | DSP | Needs |
|---|---|---|---|
| **A** — Spotify Web Playback | In-browser SDK | Volume contour only | Premium |
| **B** — System capture ★ | Spotify desktop → virtual audio device | **Full chain, real audio** | BlackHole / VB-Cable |
| **C** — Local audio | Drop in a file | **Full chain** | nothing |

Path B is the good one, and it works because the tap sits *after* the content decryption
module, on ordinary decoded PCM:

```
encrypted segments → CDM (Widevine) → decoder → PCM → virtual device → Dampen → speakers
```

No keys, no decryption, no protected stream — just an audio input device, the same as a
microphone. This is why it is reliable where page-level `getDisplayMedia` is not.

Nothing captured is ever recorded, written to disk, or sent anywhere. Realtime,
in-memory, local only.

## Positioning, and the licensing reality

Dampen is **a system audio processor** that happens to show you what Spotify is playing.
That framing is deliberate, and it is also why it is more useful: path B dampens
*anything* your machine plays — Spotify, Apple Music, YouTube, a podcast.

Being straight about the constraints, because they are real:

- Spotify's [Developer Policy §III](https://developer.spotify.com/policy) says *"Do not
  permit any device or system to segue, mix, re-mix, or overlap any Spotify Content with
  any other audio content."* So **the ambience bed is disabled whenever the source is
  captured Spotify audio.** It stays available for local files, where it is entirely fine.
- [Developer Terms §IV](https://developer.spotify.com/terms) prohibits *"modifying,
  editing, altering, creating derivative works"* of Spotify Content. Real-time DSP on
  captured output is a grey area: it circumvents no protection measure and makes no copy
  (so DMCA §1201 is not implicated), but it is plainly "altering". The exposure is
  contractual — key revocation, not prosecution.
- Spotify *does* license real-time audio manipulation, just not through the public
  platform — see the [2025 rekordbox / Serato / djay integrations](https://newsroom.spotify.com/2025-09-24/dj-software-integration-premium/).
  That door is a business conversation, not an API call.
- Dampen never rips, records, or redistributes anything, and it requires your own Spotify
  Developer app and your own Premium account.

Use it on your own machine, for your own listening. Not legal advice.

## Quick start

```bash
git clone https://github.com/tarantechnology/dampen
cd dampen
npm install
```

Register an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
and add this redirect URI exactly — Spotify rejects `localhost` for new apps, so the
loopback address must be the literal IP:

```
http://127.0.0.1:3000/api/spotify/callback
```

Then:

```bash
cp .env.example .env.local   # fill in client id + secret
npm run dev                  # → http://127.0.0.1:3000
```

Paths A and C work immediately. Signed out, path C still works — drop in a file and
the engine runs.

<details>
<summary><strong>Optional: unlock full DSP on real Spotify audio (path B)</strong></summary>

```bash
brew install blackhole-2ch          # macOS
# Windows: VB-Cable. Linux: a PulseAudio/PipeWire null sink.
```

Set the Spotify desktop app's output device to BlackHole, then choose BlackHole as
Dampen's capture device. To hear it *and* keep BlackHole as Spotify's output, create a
macOS Multi-Output Device, or just let Dampen be your monitor path.

See [docs/SPOTIFY_SETUP.md](docs/SPOTIFY_SETUP.md) for the full walkthrough.
</details>

## Stack

- **Next.js 16** App Router, **React 19**, **TypeScript** strict, **Tailwind v4**
- **Web Audio API** + three `AudioWorkletProcessor`s (bitcrush, wow/flutter, noise beds)
- Procedurally synthesised convolution impulse responses — no audio assets
- **Canvas 2D** visualiser: log-frequency axis, input spectrum ghosted beneath output
  spectrum, live filter-response curve drawn across both
- **PKCE** auth; refresh tokens stay in httpOnly cookies and never reach the browser
- **zustand** for state, **motion** for transitions

End-to-end latency on path B is **16–27 ms** at 48 kHz with a 128-frame render quantum.
Every AudioParam change is ramped, never assigned — a bare `.value =` on a live param
is audible as zipper noise, and the dial is the whole product.

## Development

```bash
npm run dev         # 127.0.0.1:3000
npm run typecheck   # tsc --noEmit, strict
npm test            # unit tests for the DSP maths
npm run build
```

`/design` renders every UI component against fixtures with no Spotify account needed.

## License

MIT

---

<p align="center"><sub>Not affiliated with Spotify. Requires your own Spotify
Developer app and, for in-browser playback, a Premium account.</sub></p>
