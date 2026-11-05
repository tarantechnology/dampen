# Dampen — Effects & Psychoacoustics Research

**Goal:** let someone hear music they love while it stays out of the way of reading, writing and thinking — "muffled", "in the next room", "pushed into the background".

**Scope of this document:** the psychoacoustic evidence for *why* certain transformations make music non-distracting, concrete numeric recipes for each transformation, Web Audio API implementation notes, a definitive feasibility verdict on Spotify, and 8 ready-to-code presets.

**Research date:** November 2026. Every numeric claim carries a source URL. Where sources disagree the disagreement is stated rather than averaged away.

---

## 0. Executive summary — the five levers that actually matter

Ranked by psychoacoustic evidence strength, not by how impressive the DSP is:

| # | Lever | Why it works | Strength of evidence |
|---|---|---|---|
| **1** | **Destroy speech intelligibility** — attenuate 1–5 kHz hard; prefer instrumentals | The irrelevant-sound effect is driven by *changing-state* and *semantic/phonological* content, not by loudness. Lyrics recruit the same verbal working memory your reading task needs. | **Strong** — 40+ years of serial-recall literature |
| **2** | **Flatten the dynamics** — high-ratio, fast-attack compression | Transients and loudness changes trigger involuntary attentional capture (the deviation effect). Steady-state sound does not disrupt serial recall; changing-state sound does. | **Strong** |
| **3** | **Collapse stereo width toward mono** | Removes 3–15 dB of binaural unmasking / spatial release from masking, so the music is easier for other sound to mask and harder to segregate as a separate stream. | **Mechanism strong, direct test missing** |
| **4** | **Lowpass + add reverb (raise the reverberant-to-direct ratio)** | Converts the music from a foreground point source into a diffuse field; removes the HF detail that carries attentional salience. | **Moderate** |
| **5** | **Add a broadband noise bed** — brown/pink, shaped to the speech band | Simultaneous masking raises the threshold for the remaining presence-region content. Useful when you cannot filter the source. Effects on cognition are individual-differences-dependent, not universal. | **Mixed / individual-differences** |

**What does *not* reliably work:** binaural beats and "brainwave entrainment" for focus; the Mozart effect; and simple volume reduction, because the irrelevant-sound effect is largely level-independent above threshold.

**Spotify verdict in one line:** the Web Playback SDK gives you `setVolume()` and nothing else — the media element is inside a cross-origin iframe and the Web Audio spec mandates silence for cross-origin media — so build Dampen on audio you control, with a native desktop OS-level audio tap as the Spotify bridge. Full detail and legal quotes in §6.

---

## 2. The "muffled / next room / underwater" effect — concrete recipes

### 2.1 What a wall actually does (get the physics right)

**The folk claim "walls kill highs, bass passes through" is directionally correct but the usual explanation is wrong, and the usual filter shape is wrong too.**

**Mass law:** transmission loss rises **+6 dB per doubling of frequency** and **+6 dB per doubling of surface mass**. Above the critical (coincidence) frequency it steepens toward +12 dB/oct. ([Ballagh, NZ Acoustics](https://acoustics.org.nz/wp-content/uploads/Ballagh_K_NZA2003.pdf))

**Critical frequency of gypsum board:** f_c = 39,000 / thickness_mm ([jhbrandt.net](https://jhbrandt.net/transmission-loss)):

| Board | f_c |
|---|---|
| 12.7 mm (1/2") | ~3,070 Hz |
| 15.9 mm (5/8") | ~2,450 Hz |

**Measured 1/3-octave TL, ASTM E90 lab report AS-TL1765** (staggered steel stud, 2× 5/8" gypsum source side, 1× 5/8" on RC-1 receive side, R-19 batts, 38.5 kg/m², **STC 57 / OITC 44**) — [PDF](https://www.acousticalsurfaces.com/wall_insulation/pdf/acoustic_test/AS_TL1765.pdf):

| Hz | TL dB | Hz | TL dB | Hz | TL dB |
|---|---|---|---|---|---|
| 50 | 18 | 400 | 57 | 2000 | **53** |
| 63 | 24 | 500 | 57 | 2500 | **53** |
| 80 | 28 | 630 | 59 | 3150 | 59 |
| 100 | 32 | 800 | 62 | 4000 | 63 |
| 125 | 40 | 1000 | **63** | 5000 | 68 |
| 160 | 44 | 1250 | 63 | 6300 | 70 |
| 200 | 49 | 1600 | 60 | 8000 | 70 |
| 250 | 53 | | | 10000 | 65 |
| 315 | 57 | | | | |

Three things fall out of that curve, and all three are design-relevant:

1. **The tilt is ~10.5 dB/octave**, not 6 and not 24. (45 dB over 4.3 octaves from 50 Hz to 1 kHz.)
2. **There is a −10 dB coincidence notch at 1.6–2.5 kHz** — a *passband leak* sitting exactly where vocal presence lives. No sound-design tutorial models this. Modelling it is a free realism win.
3. Above 3 kHz TL climbs again to 63–70 dB.

**Cheap single-stud wall** (1 layer each side, no insulation), NRC Canada, **STC 34** ([valleyacoustics](https://www.valleyacoustics.com/blogs/news/what-does-stc-mean); [Wikipedia STC](https://en.wikipedia.org/wiki/Sound_transmission_class) lists STC 33):

| 125 Hz | 160 Hz | 1000 Hz | 2500 Hz |
|---|---|---|---|
| **13.0 dB** | **12.7 dB** | **46.7 dB** | 37.4 dB |

≈ 11 dB/octave of tilt, with a 33 dB hole at 125–160 Hz.

**Mass-air-mass resonance** — the reason for that hole:

```
f0 = C * sqrt((m1 + m2) / (m1 * m2 * d))
C = 60 (empty cavity) | 43 (insulation-filled);  m in kg/m²;  d in m
```
11.0 kg/m² boards on a 3.5" (0.089 m) cavity → **f₀ ≈ 86 Hz**. Typical drywall partitions land **50–100 Hz**; designers target < 70 Hz. ([valleyacoustics](https://www.valleyacoustics.com/blogs/news/what-does-stc-mean), [Internoise 2019](https://www.sea-acustica.es/INTERNOISE_2019/Fchrs/Proceedings/1210.pdf))

NRC's Warnock & Quirt survey of 400 gypsum wall systems gives STC = −69.8 + 33.5·log(M_g) + 32.2·log(d) − 7×10⁻⁴·R + 0.0175·S_nc (r² = 0.903), notes *"resonance effects are pronounced around 125 and at 200 Hz"*, and that STC is usually controlled by TL below 500 Hz ([JCAA](https://jcaa.caa-aca.ca/index.php/jcaa/article/download/936/657/0)).

#### Does a wall highpass? **No.**

A wall is a **lowpass with a resonance bump**. It never boosts bass — it attenuates bass far less. "You only hear the bass" is the sum of three effects:

1. The ~10–11 dB/oct differential tilt above.
2. **Structure-borne flanking** — bass flexes the partition and travels via joists and floor *around* the wall ([londonsoundproofingpro](https://londonsoundproofingpro.co.uk/why-you-can-hear-neighbours-bass-not-voice/), [soundproofingcompany](https://www.soundproofingcompany.com/soundproofing_101/flanking-and-indirect-sound-leaks)).
3. **Room modes in the receiving room** boosting discrete lows. Axial: f = c/(2d), c = 343 m/s. A 4 × 3 × 2.4 m bedroom → **42.9 / 57.2 / 71.5 Hz** plus multiples ([rftools](https://rftools.io/calculators/audio/room-modes/), [Wikipedia](https://en.wikipedia.org/wiki/Room_modes)).

**Implication for Dampen: do NOT highpass for the "next room" preset.** A highpass is the one thing a wall provably does not do. (You may still want a gentle 30–40 Hz highpass purely to protect headroom and small speakers — that is a mix-hygiene decision, not a realism one.)

#### Doors and gaps — the dominant real-world path

| Element | Rating | Source |
|---|---|---|
| Hollow-core wood door, sealed | **STC 21** | [valleyacoustics](https://www.valleyacoustics.com/blogs/news/what-does-stc-mean) |
| Hollow-core, typical fitted | STC 20–25 | [secondskinaudio](https://www.secondskinaudio.com/soundproofing/best-door-for-soundproofing/) |
| Solid-core + spring brass weatherstrip | STC 27 | [trustile](https://www.trustile.com/technical-information/understanding-stc-ratings) |
| Solid-core, sealed | STC 30 | same |

Typical door undercut **8–12 mm**; a **3 mm continuous perimeter gap passes as much noise as the whole remaining wall**; sealing yields **+5 to +8 dB** in the field. Measured SPL at a door base was **9 dB louder** than at the wall. ([studiomatrx](https://www.studiomatrx.org/guides/soundproof-doors-india), [commercial-acoustics](https://commercial-acoustics.com/sound-advice/how-to-soundproof-a-door/))

A gap is a **broadband, essentially flat leak** — which is why "door ajar" recipes raise the cutoff to 3–4 kHz rather than merely raising the level. Model a door gap as a parallel dry path at low level, not as a higher cutoff.

### 2.2 Engineer-dialled "other room" values

| Scenario | Lowpass cutoff | Level drop | Slope |
|---|---|---|---|
| Next room, **door closed** | **500–800 Hz** | −25 to −30 dB | 6–12 dB/oct |
| Next room, **door open** | **2–4 kHz** | −12 to −18 dB | 6–12 dB/oct |
| Solid wall, no opening | **250–400 Hz** | −35 to −45 dB | 6–12 dB/oct |
| Party on the floor above | 300–500 Hz | −30 to −40 dB | 6–12 dB/oct |
| Down a corridor | 3–5 kHz | −10 to −15 dB | 6–12 dB/oct |
| Street through a closed window | 600 Hz–1 kHz | −20 to −30 dB | 6–12 dB/oct |

[tunaryinstruments](https://tunaryinstruments.com/guides/music-in-another-room/) — explicitly warns a steep filter "behaves like no real wall."

Competing recipe, [gazillionindustries](https://gazillionindustries.com/how-to-make-music-sound-like-another-room/): LPF **1 kHz @ 24 dB/oct** (range 500 Hz–2 kHz), level **−6 to −12 dB**, reverb **0.6–1.2 s**, pre-delay **< 20 ms**, wet **30–50%**, **+ boost 100–200 Hz** for wall resonance, HPF below 40 Hz, collapse toward mono.

> **Sources disagree on slope: 6–12 dB/oct (physics-faithful) vs 24 dB/oct (common DAW practice).** The measured TL data (~10–11 dB/oct) supports the gentler camp. 24 dB/oct over-kills 2–4 kHz relative to a real partition — and happens to over-kill the exact band where a real wall *leaks*.

### 2.3 Recommended composite "Next Room" chain (physics-weighted)

| Stage | Parameter | Value |
|---|---|---|
| Lowpass | cutoff / slope / Q | **800 Hz**, 12 dB/oct, **Q = 0.7071** (Butterworth, no ringing) |
| Peaking EQ | partition / mass-air-mass resonance | **+4 dB @ 80 Hz, Q = 1.5** |
| Peaking EQ | **coincidence leak** (the detail that sells it) | **+5 dB @ 2.2 kHz, Q = 2.0** |
| Highpass | — | **none** (optionally 30 Hz, 12 dB/oct, for headroom only) |
| Level | — | **−22 dB** |
| Width | M/S | **20%** |
| Reverb | RT60 / pre-delay / wet | **0.5 s / 8 ms / 50%** |

Note the 2.2 kHz boost sits on top of a filter that has already dropped it ~15 dB; net it is still well below the dry signal. It restores the *shape* of a real wall, not the level.

### 2.4 Underwater

#### Physics (and why the usual explanation is wrong)

| Quantity | Value | Source |
|---|---|---|
| Sound speed in water | **1480 m/s** (4.3× air's 343) | [sciencedirect](https://www.sciencedirect.com/science/article/pii/S0378595522000557) |
| Empirical | c = 1449.2 + 4.6T − 0.055T² (+ S, P terms) | [Dartmouth DUJS](https://sites.dartmouth.edu/dujs/2012/03/11/the-underwater-propagation-of-sound-and-its-applications/) |
| Air↔water impedance ratio | **~3600:1** | [PMC10323646](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10323646/) |
| Energy crossing the boundary | **~0.1% ⇒ −30 dB, broadband** | same |
| Thorp absorption | α = 0.0033 + 0.11f²/(1+f²) + 44f²/(4100+f²) + 2.75e−4·f² dB/km, f in kHz | [SonarDocs](https://gorbatschow.github.io/SonarDocs/sound_absorption_sea_thorp.en/) |

**Correction most tutorials get wrong:** at musical frequencies (20 Hz–20 kHz) water absorption is **negligible** — under 1 dB/km below 10 kHz. Water is *less* lossy than air at HF. Real underwater muffling comes from (a) the **−30 dB flat** boundary loss and (b) **your ear not working underwater** — thresholds rise, hearing becomes largely bone-conducted, and localisation collapses because the 4.3× speed increase shrinks interaural time differences by 4.3×. ([Casper & Babina, Acoustics Today](https://acousticstoday.org/wp-content/uploads/2022/03/Human-Hearing-in-the-Underwater-Environment-Brandon-M.-Casper-and-Matthew-A.-Babina.pdf))

**So "underwater" is an artistic convention. Do not derive the cutoff from physics.** The spread in published recipes confirms it:

| Source | Lowpass | Modulation | Other |
|---|---|---|---|
| [musicguymixing](https://www.musicguymixing.com/underwater-eq/) | **300 Hz** | — | — |
| [KVR 87631](https://www.kvraudio.com/forum/viewtopic.php?t=87631) | **~400 Hz** + LFO on cutoff, low depth, some resonance | — | chorus 100% wet low depth; pitch −1 semitone |
| [gazillionindustries](https://gazillionindustries.com/how-to-make-music-sound-like-another-room/) | ~400 Hz | — | — |
| [speechgen](https://speechgen.io/en/effect/underwater/) | **1.4 kHz** | vibrato 3 Hz | — |
| [soundcy](https://soundcy.com/article/how-to-make-something-sound-like-it-underwater) | **2–5 kHz** | — | chorus + phaser |

A 4-octave spread (300 Hz → 5 kHz) across sources.

#### Modulation reference values
([iZotope](https://www.izotope.com/en/learn/understanding-chorus-flangers-and-phasers-in-audio-production.html), [musicstreet](https://www.musicstreet.co.uk/blogs/blog-post/chorus-effect-explained-guitarists-producers), [soundslikeyoumusic](https://soundslikeyoumusic.com/learn/chorus-vs-flanger-vs-phaser))

| | Delay time | Rate | Depth |
|---|---|---|---|
| Chorus | **15–50 ms** (core 10–50) | **0.1–2 Hz** (typ. 0.4) | 1–10 ms (typ. 4–5) |
| Flanger | **< 10 ms** (1–5) | < 0.5 Hz classic | ~1.5 ms |

**Recommended build:** lowpass 500 Hz with **Q = 3** (resonance is what reads as "water"), LFO the cutoff ±1 octave at **0.25 Hz**, chorus 20 ms / 0.4 Hz / 30% mix, pitch −40 cents, reverb very wet.

### 2.5 Telephone / radio / walkie-talkie

| Spec | Value | Source |
|---|---|---|
| **ITU-T G.712 telephone band** | **300–3400 Hz**, flat in band, 8 kHz sample rate | [ITU-T G.712](https://www.itu.int/rec/T-REC-G.712) |
| Standard phone EQ | HPF 300 Hz / LPF 3400 Hz | [nameonthebeat](https://nameonthebeat.com/en/blogs/alles-over-vocalmixing/telephone-vocal-effect) |
| Tighter variant | HPF 300 / LPF **2700 Hz**, both **24 dB/oct** | [musicguymixing](https://www.musicguymixing.com/phone-eq/) |
| Walkie-talkie | HPF 300 / LPF 3000 Hz | [voxbooster](https://voxbooster.com/blog/radio-voice-changer/) |
| Military radio | HPF 400–500 / LPF 2500 Hz | same |
| Distortion | light saturation or bitcrush, **2–5% wet** | [voxbooster](https://voxbooster.com/blog/telephone-voice-effect-online/) |
| AM-radio lo-fi (Decapitator) | High Cut **Steep ON, 4–5 kHz** | [Decapitator manual](https://static.bhphoto.com/lit_files/89645.pdf) |

Radio chain = **bandpass + light distortion + static bed + squelch gate**; the squelch trails between phrases are what sell it. Add gentle compression to mimic radio AGC. ([voxbooster](https://voxbooster.com/blog/radio-voice-changer/))

Note: telephone is the one world here that **does** want a highpass — and a steep one. It is also, for Dampen's purposes, a *bad* background preset: 300–3400 Hz is precisely the speech band, so it maximises verbal interference (§1.3). Offer it as a stylistic preset, not a focus preset.

### 2.6 Distant / far away

**Inverse square:** −6 dB per doubling of distance for direct sound from an omni source. The reverberant field falls only ~1 dB per doubling in small rooms ([IPS, critical distance](https://ips.org.uk/encyclopedia/critical-distance/)).

**Air absorption, dB/km at 20 °C, 101.325 kPa** (Kaye & Laby, via [frontierlabs](https://www.frontierlabs.com.au/post/sound-attenuation-through-the-air)):

| f | 10% RH | 20% | 30% | 40% | **50%** | 60% | 70% | 80% | 90% |
|---|---|---|---|---|---|---|---|---|---|
| 1 kHz | 14 | 6.5 | 5 | 4.7 | **4.7** | 4.8 | 5 | 5.1 | 5.3 |
| 2 kHz | 45 | 22 | 14 | 11 | **9.9** | 9.3 | 9 | 9 | 9.1 |
| 5 kHz | 130 | 110 | 74 | 55 | **44** | 38 | 33 | 31 | 8 ⚠ |
| 8 kHz | 180 | 220 | 170 | 130 | **110** | 89 | 78 | 69 | 63 |
| 10 kHz | 190 | 280 | 240 | 190 | **160** | 130 | 120 | 100 | 95 |
| 20 kHz | 260 | 510 | 600 | 580 | **520** | 470 | 420 | 380 | 350 |

⚠ The 5 kHz / 90% RH cell reads "8" in the source; the row is monotonic otherwise, so this is almost certainly a transcription error for ~28–29.

**ISO 9613-2 Table 2** octave-band α (dB/km), widely quoted: 63 = 0.1, 125 = 0.4, 250 = 1.0, 500 = 1.9, 1k = **3.7**, 2k = **9.7**, 4k = **32.8**, 8k ≈ 117 ([ISO 9613-2](https://cdn.standards.iteh.ai/samples/20649/f3dc22f932b648bdbfb5fea04fe41f66/ISO-9613-2-1996.pdf), [windPRO App. A](https://help.emd.dk/knowledgebase/content/windPRO4.2/Appendix_A_DECIBEL.pdf)).
⚠ **The T/RH conditions for this row are not stated in the accessible excerpts and do not match 20 °C/50% RH above** — it corresponds roughly to 15 °C / 70% RH. Don't mix the two tables.

**Converted to useful distances (20 °C, 50% RH):**

| Distance | 1 kHz | 2 kHz | 5 kHz | 10 kHz | 20 kHz |
|---|---|---|---|---|---|
| **10 m** | 0.05 dB | 0.10 dB | 0.44 dB | 1.6 dB | 5.2 dB |
| **100 m** | 0.47 dB | 0.99 dB | 4.4 dB | 16 dB | 52 dB |
| **1 km** | 4.7 dB | 9.9 dB | 44 dB | 160 dB | 520 dB |

**Design conclusion: air absorption is irrelevant indoors (≪1 dB at 10 m).** Do not build "distance" out of HF rolloff at domestic scales. The dominant cue is **direct-to-reverberant ratio**.

**DRR as the distance cue:**
- Critical distance = where DRR = 0 dB ([Wikipedia](https://en.wikipedia.org/wiki/Critical_distance))
- **DRR JND: 2–3 dB** near 0 and +10 dB DRR; **6–8 dB** at −10 and +20 dB DRR ([PMC4744263](https://pmc.ncbi.nlm.nih.gov/articles/PMC4744263/))

So to move a source "twice as far": change DRR by **~5–6 dB** and level by **6 dB**. A DRR change under ~3 dB is below threshold and will read as "nothing happened."

**Mixing practice** ([SOS, Creating A Sense Of Depth](https://www.soundonsound.com/techniques/creating-sense-depth-your-mix)): roll off below **150–200 Hz**, roll off top at **~4 kHz**, bandpass the delay return 200 Hz–4 kHz, EQ slope **12 or 18 dB/oct**, pre-delay **90–110 ms** for distance/size, detune ±**7 cents**. Mike Senior's rule: **less** pre-delay on the blend reverb pushes a source *further* away ([Mixing Secrets for the Small Studio](https://www.routledge.com/Mixing-Secrets-for-the-Small-Studio/Senior/p/book/9781032840451)).

### 2.7 Memory / dream / flashback

No hard numbers exist — pure convention. Documented ingredients:

- Reverb on short flashbacks "pushes them further into memory"; used for deliberate disorientation ([iZotope](https://www.izotope.com/en/learn/reverb-in-post-production-and-sound-design.html))
- Slight pitch-down for nostalgia; chorus or phaser for movement ([soundcy](https://soundcy.com/article/how-to-make-flashback-sounds))
- **Psychoacoustic de-correlation numbers** ([Designing Sound, "Faking the Space"](https://designingsound.org/2012/12/03/psychoacoustics-faking-the-space/)): worked example duplicate offset **29 ms** at **−12.5 dB**; **Haas fusion limit 35 ms** (echo perceived beyond); comb filtering audible below **10 ms**; late reflections from **50 ms**; diffuse from **100 ms**. Max level of the delayed copy relative to direct: **+4 dB @ 10 ms, +5 dB @ 20 ms, 0 dB @ 30 ms, −3.5 dB @ 35 ms**. Safe working window **15–30 ms**.

**Composite:** LPF 2.5 kHz, reverb RT60 **4 s** / pre-delay 60 ms / wet 60%, pitch LFO ±20 cents at 0.15 Hz, width 160%, one 25 ms de-correlated copy at −10 dB.

### 2.8 Mid / presence dip — making music "sit back"

| Name | Center | Q | Gain | Source |
|---|---|---|---|---|
| **BBC / Gundry dip** | **3 kHz** | **3.0** | **−4.2 dB** | [Ethan Winer](https://ethanwiner.com/book_errata.htm) |
| BBC dip (region as argued) | 3–7 kHz, or "harshness" 2–4 kHz | — | — | [diyAudio](https://www.diyaudio.com/community/threads/bbc-dip.34354/page-3) |
| Presence cut to recede a source | **2–5 kHz** | medium | cut | [thevocalmarket](https://thevocalmarket.com/blogs/how-to/vocal-eq-cheat-sheet-for-music-producers-2026) |
| Carve-for-vocal dip | **2–4 kHz** | gentle | **−2 to −4 dB** | [masteringthemix](https://www.masteringthemix.com/pages/how-to-eq-a-mix) |
| **Smiley curve** scoop | **500 Hz – 2 kHz** | wide | cut | [Wikipedia](https://en.wikipedia.org/wiki/Smiley_face_curve) |
| **Frown curve** peak | 500–800 Hz | wide | boost | same |
| **X-curve / SMPTE ST 202 / ISO 2969** | flat to **2 kHz**, then **−3 dB/oct**; **−6 dB/oct above 10 kHz** | — | — | [mkpereport](https://mkpereport.com/2016/07/revisiting-x-curve/), [SMPTE Journal PDF](https://www.samw.org/Sound/Dolby_The%20X-Curve__SMPTE%20Journal.pdf) |

The **X-curve is the industry's codified "distance" EQ** — it exists because a distant loudspeaker in a large room subjectively matches a flat near-field one only when it measures with HF rolloff. "Flat to 2 kHz then −3 dB/oct" is an excellent, standards-backed default tilt for Dampen's gentler presets, and it is far more musical than a brick-wall lowpass.

> **Sources disagree** on whether the BBC dip is psychoacoustic (reduced diffuse-field sensitivity near 3 kHz) or an artefact of woofer beaming vs tweeter energy at a 3 kHz crossover. The −4.2 dB / Q 3 figure is one engineer's prescription, not a standard.

### 2.9 Reverb for adjacent spaces

**RT60 by space:**

| Space | RT60 (s) | Source |
|---|---|---|
| Bedroom | **0.3–0.5** | [boomspeaker](https://boomspeaker.com/calculators/rt60-reverberation-time-calculator/) |
| Bathroom | **0.4–0.7** | same |
| Hallway | **0.4–0.6** | same |
| Living room | **0.5–0.8** | [commercial-acoustics](https://commercial-acoustics.com/sound-advice/rt60-chart/) |
| Classroom | 0.4–0.7 | same |
| Office | **0.5–1.1** | same |
| Concert hall | 1.8–2.2 | same |
| Cathedral | **3.0–6.0** | same |
| St Paul's London @ 500 Hz | **11.0 s empty / 7.8 s full** | [Wikipedia](https://en.wikipedia.org/wiki/Reverberation) |

**Sabine:** RT60 = 0.161·V / A (V in m³, A in m² sabins) ([Larson Davis](https://www.larsondavis.com/learn/building-acoustics/Reverberation-Time-in-Room-Acoustics)). Sanity check: a 4 × 3 × 2.4 m bedroom = 28.8 m³; RT60 = 0.4 s ⇒ A ≈ 11.6 m² sabins ⇒ mean α ≈ 0.20 over 58 m² of surface. Plausible for a furnished bedroom.

**Pre-delay:**

| Space | Pre-delay | Source |
|---|---|---|
| Small (bedroom) | **0–10 ms** | [emastered](https://emastered.com/blog/reverb-pre-delay) |
| Medium room / chamber | **10–20 ms** | same |
| Hall / church | 20 ms+ | same |
| SOS "push far away" | 90–110 ms | [SOS](https://www.soundonsound.com/techniques/creating-sense-depth-your-mix) |

**Adjacent-room specifics.** Pre-delay must be **short (5–15 ms)** — the source is physically close; what reaches you is the adjacent room's reflection field, not a long free-field path. Wet/dry must be **very wet (50–80%)**: the direct path is occluded, so the "dry" signal is really the wall's filtered transmission, already down 20–30 dB. "Short pre-delay so it arrives as reflections rather than a direct sound" ([tunaryinstruments](https://tunaryinstruments.com/guides/music-in-another-room/)).

Early-reflection character rule: **dense, early, closely spaced ERs + short decay + tight pre-delay = small room; sparse, late ERs + long decay = hall** ([faderandknob](https://faderandknob.com/blog/early-reflections-vs-reverb-tail-room-vs-space)).

> **Sources disagree on wet amount:** 30–50% (gazillion) vs "very wet" implied by occlusion logic. Reconciliation: the 30–50% figure assumes a lightly filtered dry signal. The harder you lowpass, the higher the wet proportion must go to stay plausible.

### 2.10 Stereo width collapse — and why it reduces attentional salience

| Measure | Value | Source |
|---|---|---|
| BMLD at 500 Hz | **~15 dB** | [PMC5352611](https://pmc.ncbi.nlm.nih.gov/articles/PMC5352611/) |
| BMLD above 1500 Hz | **~3 dB** | same |
| N₀Sπ vs N₀S₀ threshold difference | **8–30 dB** depending on condition | [Wikipedia, binaural unmasking](https://en.wikipedia.org/wiki/Binaural_unmasking) |
| BMLD, random / comodulated masker | **15.4 dB / 12.1 dB** | [bioRxiv 2021.11.05.467091](https://www.biorxiv.org/content/10.1101/2021.11.05.467091v3.full) |
| Spatial release from masking, speech, co-located → separated | **up to 12 dB** (adults) | [Litovsky, Acoustics Today](https://acousticstoday.org/wp-content/uploads/2019/09/SPATIAL-RELEASE-FROM-MASKING-Ruth-Y.-Litovsky.pdf) |

**The mechanism.** Binaural unmasking and spatial release from masking say a spatially separated or interaurally *decorrelated* source is **3–15 dB easier to detect and segregate** than a co-located one. Collapsing a stereo mix to mono removes up to ~12 dB of that free unmasking advantage: the music becomes harder to attend to and easier for any competing signal (or your own noise bed) to mask — **without touching the fader**. It also strips the interaural decorrelation that creates apparent source width, so the mix stops being a "space you are inside" and becomes a point object somewhere outside you. Point objects are easier to ignore.

> **Flag:** no direct experiment comparing mono vs stereo *background music* for distraction was found. The BMLD/SRM numbers are solid; the bridge to "mono is easier to ignore" is a well-motivated inference from masking theory, not a cited finding. Related background-music/attention literature: [PMC8357712](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8357712/), [Cassidy & MacDonald 2007](https://gwern.net/doc/psychology/music/distraction/2007-cassidy.pdf).

**Practical:** width 0% (true mono sum) is strongest; 15–30% retains a trace of space and is usually more pleasant. For reference, XLN RC-20's Width knob spans **0% mono → 100% original → 200% exaggerated** ([RC-20 manual](https://assets.xlnaudio.com/documents/rc-20-retro-color_manual.pdf) p.6).

### 2.11 Compression / limiting to remove transient attention-grabs

**The relevant engineering fact, stated as a problem in the literature and as a feature here:** *"If the attack is too fast, it can squash the transient, making the instrument sound lifeless **or pushed back in the mix**"* ([masteringthemix](https://www.masteringthemix.com/blogs/learn/the-secret-to-compressor-attack-and-release-time)).

| Purpose | Ratio | Attack | Release | Gain reduction |
|---|---|---|---|---|
| **Flatten into a bed** (Dampen) | **6:1–10:1+** | **0.1–3 ms** | 30–100 ms | **8–15 dB** |
| Gentle levelling / glue | 1.5:1–2:1 | slow | auto | 1–2 dB |
| General starting point | 2:1–5:1 | — | — | — |
| Drums, punch preserved | — | 10–30 ms | 50–100 ms | — |
| Vocals, natural | — | 20–40 ms | 100–200 ms | — |

([masteringthemix](https://www.masteringthemix.com/blogs/learn/best-compression-settings-for-a-punchy-mix), [musehub](https://www.musehub.com/learn/how-to-use-a-compressor), [theproaudiofiles](https://theproaudiofiles.com/compression-techniques/))

**What actually catches a transient:** *"If you look ahead by 10 ms, any transient shorter than 10 ms will be caught. For a true 5 ms attack you need 5–10 ms of lookahead."* ([Gearspace mastering forum](https://gearspace.com/board/mastering-forum/70177-pros-cons-look-ahead.html))

| Limiter mode | Attack | Release | Lookahead |
|---|---|---|---|
| Hard brickwall | **0.1–1 ms** | 30–100 ms | **1–2 ms** |
| Transparent | — | — | 1–3 ms |
| Smooth / dense material | — | — | 5–10 ms |

Attacks of 1–5 ms **destroy transients and lose punch** ([peak-studios](https://www.peak-studios.de/en/limiter/), [vector-dsp](https://vector-dsp.com/blog/what-is-a-limiter-plugin/)) — exactly the goal.

**Web Audio note:** `DynamicsCompressorNode` has **no lookahead control** and attack range 0–1 s. `{threshold: −35, knee: 0, ratio: 12, attack: 0.003, release: 0.1}` lands close to the "flatten" row. For genuine lookahead, put a `DelayNode` on the signal path against an undelayed sidechain in an `AudioWorklet` (§5.3).

### 2.12 Tape / vinyl character

**Wow & flutter:**

| Item | Value | Source |
|---|---|---|
| 33⅓ rpm rotation | 1 rev / 1.8 s = **0.5556 Hz** ← the wow fundamental | [tonmeister.ca](https://www.tonmeister.ca/wordpress/2021/03/05/turntables-and-vinyl-part-9/) |
| 45 rpm | **0.75 Hz** | derived |
| 78 rpm | **1.30 Hz** | derived |
| "Wow" band | **0.5–6 Hz** | [Wikipedia, Wow](https://en.wikipedia.org/wiki/Wow_(recording)) |
| Flutter | above ~6 Hz (capstan-rate) | [RC-20 manual](https://assets.xlnaudio.com/documents/rc-20-retro-color_manual.pdf) p.4 |
| Typical cassette deck W&F | **0.08%** | [audiokarma](https://audiokarma.org/forums/threads/wow-and-flutter-some-figures.320629/) |
| Good direct-drive turntable | **< 0.05% WRMS** | [skrecords](https://www.skrecords.org/turntable-speed-wobble-on-sustained-notes-diagnosing-wow-and-flutter/) |
| **Audibility threshold** | **< 0.1% WRMS** inaudible to most | [stevehoffman](https://forums.stevehoffman.tv/threads/acceptable-wow-and-flutter-for-reel-to-reel-recorder.886995/) |

**Important consequence:** real-machine specs are *inaudible by design*. For a **characterful** effect you need **0.3–1.5% depth — 10–20× spec**. Conversion: **1% speed deviation ≈ 17 cents**, so 0.5% ≈ 8.7 cents, 1.5% ≈ 26 cents.

**Tape:**

| Item | Value | Source |
|---|---|---|
| Cassette S/N, no NR | **~50 dB**; Type I usable DR ~55 dB | [audiomasterclass](https://www.audiomasterclass.com/blog/whats-wrong-with-dbx), [mastering.to/cassette](https://mastering.to/cassette) |
| Type II usable DR | ~60 dB (+5 dB over Type I) | same |
| **Dolby B** | **10 dB** HF noise reduction; boosts low-level treble up to **9 dB** | [Beoworld](https://beoworld.org/dolby-noise-reduction/) |
| Type I response | **30 Hz – 15 kHz** | [mastering.to/cassette](https://mastering.to/cassette) |
| Type II response | to **18–20 kHz** | same |
| **Head bump @ 15 ips** | **~60 Hz**, +2.4 dBu at max saturation | [kiiveaudio](https://www.kiiveaudio.com/blogs/learn/15-ips-vs-30-ips-tape-speed), [Rupert Neve 542](https://rupertneve.com/products/542) |
| **Head bump @ 30 ips** | **~110–120 Hz**, +1.3 dBu (exactly one octave up) | same |
| MOL definition | **3% third harmonic** @ 315 or 400 Hz | [tapeheads.net](https://www.tapeheads.net/threads/specs-what-do-they-mean.48162/) |

**Vinyl:**

| Item | Value | Source |
|---|---|---|
| Broadband surface noise | **−32 dB** (−26 dB after RIAA EQ); **−65 dB** in a 1/3-octave band | [pspatialaudio](http://pspatialaudio.com/LP_performance.htm) |
| Quiet new LP, peak-reading | ~**−40 dB** below max velocity | same |
| LP S/N | **~50 dB**; measured DR 60–70 dB | [Wikipedia](https://en.wikipedia.org/wiki/Comparison_of_analog_and_digital_recording) |
| **RIAA time constants** | **3180 / 318 / 75 µs** → corners **50.05 / 500.5 / 2122 Hz** | [Stereophile](http://stereophile.com/content/cut-and-thrust-riaa-lp-equalization), [tonalux](https://tonalux.org/blog/riaa-equalization-vinyl-groove-three-time-constants) |
| RIAA total swing 20 Hz–20 kHz | ~**40 dB** | same |
| Inner-groove HF loss | linear velocity 37 in → 13 in per 1.8 s ⇒ effective "sample rate" **185% higher at the start** than the end | [tonmeister.ca](https://www.tonmeister.ca/wordpress/2021/03/05/turntables-and-vinyl-part-9/) |

**iZotope Vinyl's own lo-fi preset values** ([iZotope](https://www.izotope.com/en/learn/using-vinyl-for-lo-fi-vocal-effects.html), [manual](https://s3.amazonaws.com/izotopedownloads/docs/vinyl/en/using-vinyl/index.html)): Mechanical Noise **−15 dB**, Wear **8%**, Electrical Noise **−24 dB** (60 Hz hum), Dust **−15 dB**, Dust Amount **100%**, **RPM 78**.

Crucially, Vinyl's RPM control **does not change pitch** — it scales the **periodicity** of warp, dust and scratches. So **crackle density is tied to rotation rate**: a once-per-revolution scratch recurs at **0.556 / 0.75 / 1.30 events/s at 33⅓ / 45 / 78 rpm**. Dust crackle is a Poisson sprinkle on top.

> **Gap:** no authoritative published figure for vinyl crackle density in events/second was found. The per-revolution derivation above is the defensible number. Recommended Dampen values: **periodic pop at 0.556 Hz** (one per revolution, −30 dBFS) **+ Poisson crackle at 8–25 events/s, −42 to −36 dBFS**, both highpassed above ~2 kHz so they read as surface noise rather than thumps.

### 2.13 Bitcrush / sample-rate reduction

**Quantisation math:** SQNR = **6.02·N + 1.76 dB** ([Analog Devices MT-001](https://www.analog.com/mt-001)):

| Bits | SQNR |
|---|---|
| 4 | 25.8 dB |
| 6 | 37.9 dB |
| **8** | **49.9 dB** |
| 10 | 61.9 dB |
| **12** | **74.0 dB** |
| 16 | 98.1 dB |

**Classic hardware specs:**

| Machine | Bits | Sample rate | Source |
|---|---|---|---|
| **E-mu SP-1200** (1987) | **12-bit** | **26.040 kHz** (Nyquist 13.02 kHz) | [Wikipedia](https://en.wikipedia.org/wiki/E-mu_SP-1200) |
| **Akai MPC60** (1988) | **12-bit** record | **40 kHz** | [Attack Magazine](https://www.attackmagazine.com/technique/character-crunch-replicating-the-sound-of-vintage-samplers/2/) |
| **Casio SK-1** (1985) | **8-bit PCM** | **9.38 kHz** | [vintagesynth](https://www.vintagesynth.com/casio/sk-1) |

The SP-1200's **13.02 kHz Nyquist** — not its 12-bit depth — is the single biggest contributor to its character.

**Taste boundaries:**

| Goal | Bits | Sample rate | Mix |
|---|---|---|---|
| **Lo-fi warm** (recommended for Dampen) | **12-bit** | **~22 kHz** | mostly wet |
| Warm, grainier | 8–10 bit | mild SRR | mostly wet |
| Hard 8-bit console | 4–6 bit | a few kHz | 100% wet |
| Heavier lo-fi aesthetic | 8-bit | 22,050 Hz | — |

([unison.audio](https://unison.audio/bitcrushing-and-downsampling/), [gazillionindustries](https://gazillionindustries.com/bitcrushing-explained/))

**Aliasing threshold:** sample-rate reduction greater than **4×** produces severe inharmonic aliasing that reads as broken rather than warm. Below ~4× the aliased content stays quasi-harmonic. ([unison.audio](https://unison.audio/bitcrushing-and-downsampling/))

**Producer heuristic:** lower bit depth until you hear grain (usually 12 → 8 bits), then lower sample rate until the top softens and shimmers. **A post-crush lowpass is standard practice, not optional** — RC-20's Digital module has a dedicated "Smooth" control to "polish off the rough digital edges" ([RC-20 manual](https://assets.xlnaudio.com/documents/rc-20-retro-color_manual.pdf) p.4).

For Dampen specifically: at 12-bit the quantisation floor sits at −74 dB, inaudible under any noise bed. **The bitcrush is almost purely decorative here; the decimation lowpass does the real work.** Prefer honest filtering plus a tape/vinyl noise bed over aggressive bitcrushing, which is fatiguing over multi-hour sessions.

---

## 6. CRITICAL FEASIBILITY: Spotify + Web Audio

### 6.1 Short answer

**You cannot filter Spotify Web Playback SDK audio with the Web Audio API.** Not because of DRM alone — the actual blocker is simpler and harder: the SDK's media element lives inside a **cross-origin iframe** you have no DOM access to, and even if you did, the Web Audio spec **mandates silence** for CORS-cross-origin media. Separately, Spotify's Developer Terms and Developer Policy explicitly forbid altering Spotify Content and mixing it with other audio.

### 6.2 Does DRM/EME itself zero the samples? (More nuanced than folklore)

The commonly repeated claim "DRM makes `MediaElementAudioSourceNode` output silence" is **only partly true**. The primary sources:

**EME spec §7.6 "Media Element Restrictions"** (non-normative) — permissive, not prohibitive:

> "Media data processed by a CDM MAY be unavailable through web platform APIs in the usual way (for example using the `CanvasRenderingContext2D` `drawImage()` method and the `AudioContext` `MediaElementAudioSourceNode`). This specification does not define conditions for such non-availability of media data, however, if media data is not available to through such APIs then they MAY behave as if no media data was present at all."
> — https://www.w3.org/TR/encrypted-media-2/#media-element-restrictions

So EME **permits** but does not **require** zeroing. Vendor behaviour, measured:

| Browser | `createMediaElementSource()` on EME audio-only element | Source |
|---|---|---|
| Chrome/Chromium | Historically **allowed** — returns a working node; audio-only capture from EME elements is permitted (video is not) | https://bugzilla.mozilla.org/show_bug.cgi?id=1331763 (reporter: "In Chrome, createMediaElementSource would return a MediaElementSourceAudioNode instance") |
| Firefox ≤54 | Threw `NotSupportedError: Operation is not supported` | Same bug, Description |
| Firefox 55+ | Restriction **removed** on purpose. Chris Pearce: *"This was indeed by design, and we made this decision when the only DRM scheme we supported was Adobe's. Given that we're now using the same DRM scheme as Chrome… it doesn't make sense to be more restrictive than Chrome."* | https://bugzilla.mozilla.org/show_bug.cgi?id=1331763#c2 |
| Firefox 2025+ | **Regression/never actually worked**: bug 1950502 "AudioContext#createMediaElementSource breaks playback of DRM (EME) content" — silence and `currentTime` stops advancing. Still UNCONFIRMED. Note in that bug: the FF55 tests only verified the call *didn't throw*, not that audio flowed. | https://bugzilla.mozilla.org/show_bug.cgi?id=1950502 |

Practitioners who ship audio-effect extensions report silence in practice. The maintainer of the `auracore` audio-effects extension states flatly: *"Web Audio on a DRM media element returns silence"*, and that Chrome must therefore reach protected services *"through `chrome.tabCapture` and an offscreen document"* (https://github.com/lucaswotta/auracore/issues/8).

**Verdict:** treat EME + Web Audio as **unreliable and non-contractual**. It is explicitly undefined by spec, it differs per browser and per browser version, and it is a path a vendor can close at any time for content-protection reasons. Do not build on it.

### 6.3 The decisive blocker: the SDK's element is in a cross-origin iframe

Even setting DRM aside, two hard walls:

**(a) No DOM handle.** The Web Playback SDK injects an iframe from a Spotify-controlled origin and the media element lives inside it. From the official SDK issue tracker:

> "As the `audio` element lives within an iframe that is on an external cross-origin URL, there is no way to add something like this to it"
> — https://github.com/spotify/web-playback-sdk/issues/105

You cannot reach `iframe.contentDocument`, so you cannot call `createMediaElementSource()` on it at all. (This is also why the SDK has no Media Session / no visualiser support.)

**(b) CORS silence is normative.** If the resource is CORS-cross-origin, silence is *required*, not optional:

> "To prevent this, a `MediaElementAudioSourceNode` MUST output silence instead of the normal output of the `HTMLMediaElement` if it has been created using an `HTMLMediaElement` for which the execution of the fetch algorithm [FETCH] labeled the resource as CORS-cross-origin."
> — Web Audio API 1.1 §1.22.4, https://www.w3.org/TR/webaudio-1.1/#MediaElementAudioSourceOptions-security

And it is **silent, undetectable, and irreversible** — you get zeros with no error:

> "cross-origin media playback is allowed, but `MediaElementAudioSourceNode` outputs zeroes for such media… when you call `createMediaElementSource` for such media it simply gets muted with no conservative … way to revert it."
> — https://github.com/WebAudio/web-audio-api/issues/2453

(Spotify streams via MSE, so inside the iframe the element's src is a same-origin `blob:` URL — meaning Spotify's *own* iframe script could legally tap it. Yours cannot.)

Also relevant: Spotify's playback requests a Widevine licence from `https://api.spotify.com/v1/widevine-license/v1/audio/license`, and the SDK requires EME + Widevine (which is why stock Electron fails and castLabs' Widevine-enabled Electron fork is used) — https://alexanderallen.medium.com/spotify-web-playback-sdk-feat-electron-50ff930d5c74

### 6.4 What the Web Playback SDK *does* let you control

Full surface (https://developer.spotify.com/documentation/web-playback-sdk/reference):

| Capability | Method | Notes |
|---|---|---|
| Volume | `setVolume(0..1)`, `getVolume()` | Float 0–1. **iOS: `getVolume()` always returns 1 and volume cannot be set from JS.** This is the only "dampening" lever the SDK gives you. |
| Transport | `play()`/`resume()`, `pause()`, `togglePlay()`, `nextTrack()`, `previousTrack()` | Promise-returning |
| Position | `seek(position_ms)` | ms |
| Lifecycle | `connect()`, `disconnect()`, `activateElement()` | `activateElement()` needed for autoplay-restricted browsers |
| Identity | `setName(name)` | Renames the Connect device |
| State | `getCurrentState()` → `WebPlaybackState` | `context`, `disallows`, `paused`, `position_ms`, `repeat_mode`, `shuffle`, `track_window{previous_tracks, current_track, next_tracks}` |
| Events | `addListener`/`removeListener` for `ready`, `not_ready`, `player_state_changed`, `autoplay_failed`, `initialization_error`, `authentication_error`, `account_error`, `playback_error` | |
| Constructor | `name`, `getOAuthToken`, `volume`, `enableMediaSession` | Premium account required (`account_error` otherwise) |

**No EQ, no filter, no sample access, no analyser, no pitch/tempo, no crossfade, no element reference.** Volume is the entire DSP surface.

### 6.5 Is `preview_url` (30-second MP3) still usable in 2026?

**For practical purposes: no, unless you are a grandfathered extended-quota app.**

Timeline:

| Date | Change | Source |
|---|---|---|
| 2024-11-27 | Spotify restricted 8 endpoint families for *new* use cases: Related Artists, Recommendations, Audio Features, Audio Analysis, Get Featured Playlists, Get Category's Playlists, **30-second preview URLs in multi-get `SimpleTrack` responses**, and algorithmic/Spotify-owned editorial playlists. Verbatim: *"Effective today, **new** Web API use cases will no longer be able to access or use the following endpoints and functionality in their third-party applications."* Apps already in extended mode: *"Applications with existing extended mode Web API access that were relying on these endpoints remain unaffected by this change."* | https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api |
| 2025-05-15 | Quota-extension applications tightened (reports of a 250k MAU bar); new Developer Policy effective date | https://developer.spotify.com/policy ; https://developers.brizm.dev/blog/spotify-api-changes-2026/ |
| 2026-02-11 (new apps) / 2026-03-09 (existing) | Development Mode now requires a **Spotify Premium account**, **one Development Mode Client ID per developer**, and **max 5 authorized users**. Endpoint-access restrictions for *existing* integrations were *postponed*. | https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security |
| Now | `GET /tracks/{id}` still documents the field: *"A link to a 30 second preview (MP3 format) of the track. Can be `null`"* — flagged **Nullable** and **Deprecated**. New apps get `null` with no error. | https://developer.spotify.com/documentation/web-api/reference/get-track |

Even where it still returns a URL, Developer Policy §V constrains it: Audio Preview Clips "may only be used to promote the underlying content and not for personalization… products", must link back to Spotify, and "You must not offer Audio Preview Clips as a standalone service or product." A 30-second muffled clip player is squarely a "personalization product" and a standalone use. **Do not architect on `preview_url`.**

### 6.6 Can `getDisplayMedia({audio:true})` capture DRM audio? Can a page capture its own tab?

Two separate questions.

**(a) DRM + tab audio capture.** The mechanism matters: the capture tap sits **after** the CDM, on decoded PCM in the tab's audio mix — no keys, no decryption, no protected stream access:

```
encrypted segments → CDM (Widevine L3) → decoder → PCM → tab audio mix
                                                          ├→ speakers
                                                          └→ chrome.tabCapture
```
— https://github.com/tntomg/tab-audio-capture-study

Empirically, **`chrome.tabCapture` (extension-only API) does capture DRM-protected audio**, and shipping extensions rely on it: `tab-equalizer` works on "YouTube, Spotify Web, Netflix, SoundCloud" and uses an opt-in "Protected boost" mode per tab specifically for Spotify Web (https://github.com/vaibhav-1508/tab-equalizer). `auracore` ships Chrome/Edge-only for exactly this reason (https://github.com/lucaswotta/auracore/issues/8).

For **page-level `getDisplayMedia()`** the picture is murkier and reports conflict: multiple recorder vendors state DRM tabs (Netflix, Disney+, Spotify Web) capture as silence/black, while the post-CDM argument above suggests audio should pass. **Sources disagree; this needs an empirical test on your target Chrome version.** Note also that video is separately blocked by the protected-content path (black frames) even when audio passes — the two pipelines are independent. Firefox and Safari ignore the `audio` constraint in `getDisplayMedia()` entirely, so there is no audio on those browsers at all.

**(b) Self-tab capture without a feedback loop — solved, two ways:**

- **Extension / `chrome.tabCapture`:** the loop is closed for you. Spec: *"When a `MediaStream` is obtained for a tab, audio in that tab will no longer be played to the user."* You then re-play it yourself: `new AudioContext()` → `createMediaStreamSource(stream)` → your FX chain → `destination`. (https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- **Page / `getDisplayMedia`:** pass `audio: { suppressLocalAudioPlayback: true }` — "the browser should stop relaying audio to the local speakers when capture starts" (Chrome/Edge 105+, not Baseline; absent in Firefox/Safari). Also set `echoCancellation: false, noiseSuppression: false, autoGainControl: false` — voice processing badly damages music. (https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/suppressLocalAudioPlayback)

MV3 mechanics: service worker calls `chrome.tabCapture.getMediaStreamId({targetTabId})` **after a user gesture**, posts the id to an **offscreen document** (Chrome 116+), which calls `getUserMedia({audio:{mandatory:{chromeMediaSource:'tab', chromeMediaSourceId:id}}})`. Manifest needs `tabCapture` + `offscreen`. (https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)

Mobile browsers: no tab audio capture at all.

### 6.7 What the Spotify legal documents actually say

Three documents bind three different kinds of product. Quote-accurate:

**Developer Policy** (effective 15 May 2025 — https://developer.spotify.com/policy), §III "Some prohibited applications":

> "Do not permit any device or system to segue, mix, re-mix, or overlap any Spotify Content with any other audio content (including other Spotify Content)."

> "Do not synchronize any sound recordings with any visual media, including any advertising, film, television program, slideshow, video, or similar content."

> "Do not create any product or service which is integrated with streams or content from another service."

> "Do not build products or services that mimic, or replicate or attempt to replace a core user experience of Spotify or its group companies without our prior written permission. Your product or service must add independent value or functionality that improves users' interactions with Spotify."

The first clause is fatal to "music + rain noise bed": a noise layer **is** other audio content overlapped with Spotify Content. It is the same clause cited when Spotify terminated all third-party DJ-app integrations in July 2020 (https://musically.com/2020/03/23/algoriddim-reveals-spotify-is-pulling-support-for-dj-apps/).

**Developer Terms** §IV "Restrictions" (https://developer.spotify.com/terms):

> "Do not misuse the Spotify Platform, including by … modifying, editing, altering, creating derivative works, disassembling, decompiling, reverse-engineering, or extracting source code from the Spotify Platform (including any client libraries), Spotify Service, or **Spotify Content** (except to the extent such restrictions are expressly prohibited by law). You may adjust the size of metadata or cover art as necessary"

> "Do not facilitate unauthorized access to the Spotify Service or Spotify Content, including … facilitating 'stream ripping' or other functionalities that make it easier for users to capture or otherwise make permanent copies of Spotify Content."

> §V: "You must display and require end users to agree to an enforceable end user agreement reflecting at least the following minimum terms: … prohibit modifying or creating derivative works based on the Spotify Platform, Spotify Service or Spotify Content"

Note the carve-out granted is *"You may adjust the size of metadata or cover art"* — i.e. the only permitted alteration is to artwork dimensions. Filtering audio is "modifying, editing, altering… Spotify Content".

**Consumer User Guidelines** (https://www.spotify.com/us/legal/user-guidelines/) — these bind a browser extension or native app even if it never touches the developer platform, because the *user* is bound:

> "reverse-engineering, decompiling, disassembling, modifying, or creating derivative works, except where such restriction is expressly prohibited by applicable law"

> "copying, reproducing, redistributing, 'ripping,' recording, transferring, performing, framing, linking to or displaying to the public, broadcasting, or making available to the public, or any other use which is not expressly permitted under the Agreements"

> "circumventing any technology used by Spotify, its licensors, or any third party, including any territorial or other content access restrictions applied by Spotify or its licensors"

> "deleting or **altering any part of the Services or Content** except as expressly permitted under the Agreements"

**Honest reading.** A post-CDM `tabCapture` EQ does *not* circumvent a technological protection measure (no keys, no decryption — so US DMCA §1201 is not implicated) and does not make a permanent copy (so it is not "ripping"). But "modifying… Content" and "altering any part of the… Content" do plainly describe real-time DSP. Enforcement risk is contractual, not criminal: extension takedown, API key revocation, account suspension. Many EQ/bass-boost extensions operate in this grey zone today and have not been removed. I am not a lawyer; treat this as a risk assessment, not advice.

**The precedent that matters most:** Spotify **does** license real-time audio manipulation — just not through the public platform. On 2025-09-24 Spotify returned to rekordbox, Serato and djay in 51 markets (https://newsroom.spotify.com/2025-09-24/dj-software-integration-premium/), extending to mobile 2025-12-11 and to VirtualDJ/Cross DJ/edjing Mix on 2026-09-15. These are *"separate partnerships with Spotify, not something any developer can switch on with the public SDK"* (https://www.clubdjsoftware.com/blog/can-you-dj-with-spotify). So the door exists; it is a BD conversation, not an API call.

### 6.8 Ranked architectures for "Spotify + muffling"

| # | Architecture | Audio quality control | Works? | Legal posture | Reach |
|---|---|---|---|---|---|
| **1** | **Own audio: local files / user-uploaded / CC catalogue.** File System Access API or `<input type=file>` → `decodeAudioData` → full Web Audio chain. Use Spotify Web API only for metadata/artwork/playlist mirroring (or skip it). Legit raw-audio catalogues: Jamendo (CC, `audiodownload_allowed`, 35k req/mo free non-commercial), Audius (`GET /v1/tracks/{id}/stream`, open, no approval), Internet Archive, Free Music Archive. | **Total** — every effect in this document | Yes | Clean | Limited to what the user owns / CC catalogue |
| **2** | **Native desktop app with OS-level process audio tap.** Spotify's own client plays; Dampen taps it and applies DSP. macOS 14.2+: **CoreAudio process tap** (only "System Audio Recording" TCC prompt, no virtual driver, no screen-recording grant); ScreenCaptureKit as fallback for older macOS. Windows: **WASAPI process loopback** (`ActivateAudioInterfaceAsync`, per-process since Win 10 1703+). Control transport via Spotify Web API "Player" endpoints or Connect. | **Total**, incl. full convolution reverb and noise bed | Yes, proven (every meeting recorder does this) | Grey. No TPM circumvention, no copies. Violates Policy §III mixing clause **if** you use the developer platform; if you take no API key and only tap system audio, you are bound by the consumer User Guidelines "altering any part of the… Content" clause instead. | Desktop only; needs a permission grant |
| **3** | **Chrome/Edge MV3 extension + `chrome.tabCapture` + offscreen document.** Tap the Spotify Web Player tab post-CDM, run the FX chain, re-emit. Tab is auto-muted → no feedback loop. | **Total** | Yes, proven (tab-equalizer, auracore) | Same grey as #2, plus Chrome Web Store policy risk | Chrome/Edge desktop only. **No Firefox** (no `tabCapture`/offscreen), no Safari, no mobile |
| **4** | **Web Playback SDK, volume-only "dampening."** `setVolume()` ducking + optional *separately played* ambience that the user starts themselves. No filtering of Spotify audio. | **None** — level only. You can't lowpass, can't collapse stereo, can't add reverb. | Yes | Still bumps Policy §III if *your app* plays the ambience simultaneously. Safest variant: duck Spotify, and let the OS/another app provide ambience. | All Premium + EME browsers; iOS `setVolume` is a no-op |
| **5** | **Negotiated Spotify partnership** (the rekordbox/Serato/djay route). | **Total**, officially sanctioned | Yes | Fully licensed | Requires Spotify BD approval; realistically needs scale |
| ✗ | **Web Playback SDK → `MediaElementAudioSourceNode`** | — | **No.** Cross-origin iframe, no DOM handle; CORS silence is normative; EME behaviour undefined | — | — |
| ✗ | **`preview_url` 30s clips** | Would be total (plain MP3, CORS-permitting) | **No** for apps registered after 2024-11-27; deprecated/nullable | Policy §V forbids standalone/personalization use anyway | — |
| ✗ | **Apple Music / MusicKit JS instead** | — | **No.** Same EME wall; MusicKit exposes no raw buffers or FFT for protected tracks | — | — |

### 6.9 Recommendation

Ship **#1 as the product** and **#2 as the Spotify bridge**:

1. **v1 (web, clean):** full Web Audio FX engine over local/user files + a CC catalogue. This is the only architecture where the entire preset table in §8 is actually implementable, and it has zero legal exposure. It also lets you build and tune the DSP immediately.
2. **v2 (desktop, Spotify):** Electron/Tauri app with a CoreAudio process tap (macOS) / WASAPI process loopback (Windows) feeding the *same* Web Audio graph via `AudioWorklet`. Use Spotify Web API Player endpoints for transport + now-playing metadata. Position it as a system audio processor (an EQ), not a Spotify client, and do not bundle Spotify branding.
3. **Never** depend on `preview_url`, `MediaElementAudioSourceNode` over EME, or page-level `getDisplayMedia` for Spotify.
4. If Dampen gets traction, approach Spotify for the DJ-style partnership — that programme is the only sanctioned path to altering Spotify audio.

Also note the asymmetry worth exploiting: **almost all of the psychoacoustic benefit in §1 comes from removing the 1–5 kHz presence region, collapsing stereo, and killing transients** — all of which require sample access. Volume reduction alone (architecture #4) does *not* reduce semantic/verbal interference, because the irrelevant-sound effect is largely level-independent above threshold (§1.1). So "Spotify + volume ducking" is not a degraded version of Dampen; it is a different, much weaker product.
