# Dampen — Effects & Psychoacoustics Research

**Goal:** let someone hear music they love while it stays out of the way of reading, writing and thinking — "muffled", "in the next room", "pushed into the background".

**Scope:** the psychoacoustic evidence for *why* certain transformations make music non-distracting; concrete numeric recipes for each transformation; Web Audio API implementation notes; a definitive feasibility verdict on Spotify; and 8 ready-to-code presets matched to `lib/types.ts`.

**Research date:** November 2026. Every numeric claim carries a source URL. Where sources disagree the disagreement is stated rather than averaged away. Numbers that are this document's own arithmetic over cited primary values are marked *derived*.

---

## 0. Executive summary — the five levers that actually matter

Ranked by **strength of evidence**, not by how impressive the DSP is. This ranking is deliberately not the intuitive one.

| # | Lever | Why it works | Evidence |
|---|---|---|---|
| **1** | **Collapse spectral detail to ≤ 2 effective channels in the speech band.** Heavy band-limiting plus spectral smearing. | Noise-vocoded speech with **1 or 2 bands produces no irrelevant-sound effect vs silence; 4 or 20 bands roughly doubles error rate.** It is the number of independently-moving spectral channels that does the damage, not the envelope. | **Strongest single finding in the literature** (§1.5) |
| **2** | **Lowpass near 1 kHz with a steep tail above 1.6 kHz.** | French & Steinberg 1947: a lowpass at 1 kHz drops syllable articulation from **~98 % to 27 %**. Removes 0.79 of total ANSI band importance while leaving bass audibly present. Also drops Zwicker sharpness below the 1.75 acum annoyance dead-zone. | **Strong**, 1947 and never overturned (§1.4) |
| **3** | **Destroy lyric intelligibility — fully, not partially.** | Meta-analysis: lyrical music is **statistically indistinguishable from an audiobook** for reading comprehension (54 % probability of any true difference). Removing lyrics buys Δg ≈ 0.19. But 75 %-intelligible lyrics still produced η² = 0.37. | **Strong** (§1.3) |
| **4** | **Collapse stereo width toward mono.** | Removes **3–15 dB** of binaural unmasking / spatial release from masking, so the music is easier for other sound to mask and harder to segregate as its own stream. | **Mechanism strong; no direct test** (§2.10) |
| **5** | **Add a broadband noise bed, shaped like speech.** | Noise maskers are **9–19 dB more effective per dB** than tonal maskers. The optimum office masking spectrum turns out to be an LTASS-shaped noise — two fields converging on the same curve. | **Good for masking; mixed for cognition** (§3) |

### What does NOT work, with the numbers

| Intuition | Reality |
|---|---|
| **"Just turn it down."** | The irrelevant-sound effect is **level-independent above threshold** (Ellermeier & Hellbrück 1998). Volume reduction lowers annoyance and nothing else. ⚠ One 2022 preregistered replication disputes this. |
| **"Compress the dynamics so nothing jumps out."** | Correct for *annoyance*, wrong for *interference*. Amplitude modulation alone produces **ADER 1.2 pp** (Salamé & Baddeley) and even **−1.1 pp** (Jones et al.) — numerically better than silence. Compress for attentional capture, not for verbal interference. |
| **"Classical / Mozart helps you think."** | Pooled **d = 0.09, P = 0.26** vs silence (Chabris 1999, N = 714). Mozart vs *other music* d = 0.15. The effect is arousal-and-mood, bias-inflated, and on the wrong task. |
| **"Binaural beats aid focus."** | Entrainment fails: **8 of 14 EEG studies contradictory**, 5 supporting. And a 1–30 Hz beat is a *changing-state, amplitude-modulated* signal — on the best theory of distraction, counterproductive. |
| **"Lo-fi beats are scientifically proven."** | No study establishes it. The one 120-person trial found lo-fi helped sustained attention **no more than jazz or piano**. Two widely-cited supporting studies **appear not to exist**. |
| **"ASMR is calming, so it helps."** | Zero ASMR studies measured task performance. And its #1 trigger — **whispering, 75 %** — is the single most disruptive stimulus class for verbal working memory. |
| **"Brown noise is best for concentration."** | **Zero brown-noise studies exist.** The 2024 meta-analysis found none. Worse, the real finding is an *interaction*: white/pink noise helps attention-impaired listeners (**g = 0.249**) and **harms** controls (**g = −0.212**). |

### The independent convergence worth trusting

Two unrelated fields reach the same conclusion by different methods. The irrelevant-sound literature says disruption tracks the **rate of discriminable spectral events**, not loudness. ISO 12913 soundscape research defines "calm" as pleasant **and uneventful** — low **event density**, not low level. When two methodologies agree, that is the strongest evidence available here.

**Spotify verdict in one line:** the Web Playback SDK gives you `setVolume()` and nothing else — the media element lives inside a cross-origin iframe and the Web Audio spec *mandates* silence for cross-origin media — so build Dampen on audio you control, with a native desktop OS-level audio tap as the Spotify bridge. Full detail, quoted legal clauses and ranked architectures in §6.

---

## 1. Psychoacoustics of background music & cognitive load

**Headline finding, stated up front because it overturns the obvious design intuition:** the single best-supported lever is removing *spectral* change — specifically the number of independently-moving spectral channels in the speech band — **not** removing amplitude or dynamic change. Amplitude modulation on its own is repeatedly shown to produce **no** memory disruption at all.

### 1.1 The Irrelevant Sound Effect — and why turning the volume down does not work

The canonical effect-size compilation is Ellermeier & Zimmer (2014), *Acoust. Sci. Technol.* 35(1):10–16, "The psychoacoustics of the irrelevant sound effect" — [open access](https://www.jstage.jst.go.jp/article/ast/35/1/35_E141002/_article) ([PDF](https://www.jstage.jst.go.jp/article/ast/35/1/35_E141002/_pdf)). Two metrics: **ADER** = absolute difference in error rate (percentage points vs quiet); **RDER** = relative difference = (E_sound − E_quiet)/E_quiet.

| Category | Study | Stimulus | **ADER (pp)** | **RDER (%)** |
|---|---|---|---|---|
| **Speech** | Salamé & Baddeley 1982 Exp.1 | nonsense words | 8.8 | 54.7 |
| | Tremblay et al. 2000 Exp.1 | words | **29.0** | **96.6** |
| | Buchner et al. 2004 Exp.1 | words | 14.0 | 32.5 |
| | Ellermeier & Zimmer 1997 | unfamiliar language | 13.3 | 48.0 |
| | Jones, Alford et al. 2000 Exp.2 | words | 16.5 | 54.1 |
| **Music** | **Salamé & Baddeley 1989 Exp.1** | **vocal music** | **14.2** | **38.8** |
| | **Salamé & Baddeley 1989 Exp.1** | **instrumental music** | **4.8** | **13.1** |
| | Klatte & Hellbrück 1993 | instrumental music | 7.4 | 62.7 |
| | Nittono 1997 | instrumental music | 5.8 | 29.3 |
| | Ellermeier & Hellbrück 1998 Exp.1 | soft music | 7.6 | 37.3 |
| **Backward speech** | Jones, Miles & Page 1990 Exp.5 | backward speech | 8.3 | 33.9 |
| | LeCompte et al. 1997 Exp.4 | reversed words | 14.1 | 49.5 |
| | Viswanathan et al. 2013 Exp.2 | **reversed sinewave speech** | 6.0 | 15.0 |
| **Tones / FM** | Jones & Macken 1993 Exp.1 | varying tones | 5.5 | 23.2 |
| | LeCompte et al. 1997 Exp.1 | varying tones | 4.0 | 11.8 |
| | Jones, Macken & Murray 1993 | interrupted FM tones | 4.7 | 26.6 |
| | Jones, Alford et al. 2000 | cello notes | 7.0 | 29.2 |
| **Level change / AM** | **Salamé & Baddeley 1989 Exp.3** | **AM noise (speech envelope)** | **1.2** | **3.9** |
| | **Jones et al. 1992 Exp.2b** | **AM noise** | **−1.1** | **−5.7** |
| | Klatte et al. 1993 Exp.3 | AM "speechlike" noise | 2.7 | 11.9 |
| | **Tremblay & Jones 1999 Exp.1** | **changing level** | **2.2** | **5.9** |

A continuum, in the authors' own reading: *small* for pure amplitude/frequency variation → *medium* for backward speech and music → *maximal* for free-running natural speech. Headline magnitude: **~50% relative increase in serial-recall errors for irrelevant speech vs quiet** (Ellermeier & Zimmer 1997, *JASA* 102:2191–2199, N = 71 individual RDERs spanning −30% to > 240% — [doi](https://doi.org/10.1121/1.419596)).

**Salamé & Baddeley 1989** ([full PDF](https://gwern.net/doc/psychology/music/distraction/1989-salame.pdf)) is the key study for a music product. Nine visually presented digits, serial recall; silence = 37 dB(A) ambient, all sound conditions **75 dB(A)**:

| Experiment | Condition | Mean % error |
|---|---|---|
| Exp. 1, F(2,24) = 42.42, p < .001 | **vocal music** | **50.8 %** |
| | **orchestral (instrumental)** | **41.4 %** |
| | silence | 36.6 % |
| Exp. 2 (practised Ss, N = 24), F(2,36) = 9.84, p < .001 | vocal | 29.1 % |
| | instrumental | 25.3 % |
| | silence | 22.2 % |
| | Newman–Keuls | vocal > instrumental p < .05; **instrumental not significantly worse than silence** |
| **Exp. 3**, F(3,60) = 42.53, p < .001 | ordering | **noise = silence < instrumental music < speech** (both p < .01) |

**Exp. 3 is the decisive one.** They took Arabic speech and built a noise amplitude-modulated with the *identical envelope* of that speech. Matching the amplitude envelope of speech produced essentially nothing: **ADER 1.2 pp, RDER 3.9%.** Speech itself produced a large effect. Amplitude envelope is not the carrier of disruption.

Salamé & Baddeley (1982), *JVLVB* 21:150–164, established the base case: irrelevant speech disrupts visual serial recall; **pink/white noise bursts have very little if any effect vs quiet**; the interfering material must be phonological in form. ([history and critique](https://pmc.ncbi.nlm.nih.gov/articles/PMC11783984/))

#### Three robust negative findings you can exploit

Per Ellermeier & Zimmer's list of "numerously replicated" ISE facts:

1. **Stationary / non-changing sounds do not affect performance vs quiet.** Unmodulated noise, or a repeated identical syllable, ≈ silence.
2. **Overall playback level does not modulate ISE magnitude** — Ellermeier & Hellbrück (1998), *JEP:HPP* 24:1406–1414, "Is level irrelevant in 'irrelevant speech'?" ([record](https://psycnet.apa.org/record/1998-10547-013)). **You cannot solve distraction by turning the music down.** ⚠ Contested: a 2022 preregistered replication found loud distractors *were* harder to ignore after all ([Hogrefe](https://econtent.hogrefe.com/doi/10.1027/1618-3169/a000554)). Unresolved — but even the pro-level side reports a modulation, not the primary mechanism.
3. **The semantics of irrelevant speech are largely irrelevant for serial recall** (Jones, Miles & Page 1990) — but they matter a great deal for *reading comprehension* (§1.2).

> **This is the fact that makes Dampen a product rather than a volume slider**, and it is the claim §6.9 depends on: level reduction alone does not reduce verbal interference. It reduces annoyance, and nothing else.

### 1.2 Changing-state vs steady-state, and the duplex mechanism

**Changing-state hypothesis** (Jones & Macken 1993, *JEP:LMC* 19:369–381, [record](https://psycnet.apa.org/record/1993-27568-001)): a stream of *changing* tones is as disruptive as four changing syllables; a repeated syllable varying only in pitch also disrupts. The locus is storage, not encoding. Jones, Madden & Miles (1992), *QJEP* 44A:645–669: a repeated single syllable ≈ quiet.

**Clean per-condition recall proportions** (Joseph, Hughes, Sörqvist & Marsh, *Journal of Cognition* 2018, [open access](https://journalofcognition.org/articles/10.5334/joc.15)); N = 89 children (7–9 y) + 89 adults (18–22 y):

| Condition | Proportion correct | Δ from quiet |
|---|---|---|
| **Quiet** | **.67** | — |
| Steady-state | .64 | **−3 pp** |
| **Changing-state** | **.61** | **−6 pp** |
| Steady-state + deviant | .62 | −5 pp |
| **Changing-state + deviant** | **.57** | **−10 pp** |

Changing-state main effect **η² = .15**; deviation main effect **η² = .15**; Age × Deviation F(1,176) = 3.83, p < .03, η² = .02 (children are more vulnerable to deviants, equally vulnerable to changing state).

**Practical calibration: steady-state sound costs ~3 pp of serial recall (often n.s.); changing-state ~6 pp; an unexpected deviant adds another ~4 pp.**

**Duplex-mechanism account** — Hughes, Vachon & Jones (2007), *JEP:LMC* 33:1050–1061 ([record](https://psycnet.apa.org/record/2007-17469-005)); Hughes (2014), *PsyCh Journal* ([link](https://www.semanticscholar.org/paper/1d9163eb0f6322bea56b73349224876ee8983780)). Two functionally distinct mechanisms, with different design consequences:

| Mechanism | What it is | Controllable? | Design handle |
|---|---|---|---|
| **Interference-by-process** (changing-state effect) | Obligatory order-encoding of the sound conflicts with deliberate serial rehearsal | **No** — not amenable to top-down control; immune to task difficulty and foreknowledge; requires the focal task to involve seriation | **Only fixable in DSP.** Remove the seriable structure: collapse spectral channels, band-limit, flatten spectral motion |
| **Attentional capture / diversion** (deviation effect) | A sound violating the prevailing auditory scene's expectations causes disengagement | **Yes** — attenuated by task engagement, high working-memory capacity, high task load | Maximise *predictability*; avoid novel events; long, soft onsets |

Deviation effect sizes in this literature: **d = 0.93** and **d = 1.22** in individual experiments ([Vachon, Labonté & Marsh](https://knowledge.lancashire.ac.uk/id/eprint/15432/1/Vachon,%20Labont%C3%A9%20&%20Marsh%20(accepted).pdf)); [Sörqvist 2010](https://link.springer.com/content/pdf/10.3758/MC.38.5.651.pdf) on WMC attenuating it.

**Expectancy, not local change, drives capture magnitude** — Parmentier et al., *PLOS ONE* 2012 ([link](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0048569)): interaction ηp² = .39 (F(1,49) = 31.28); oddball-pitch main effect ηp² = .10; **the effect only emerges after the sequence has been learned.**

> **Design consequence: a repetitive, highly predictable texture suppresses capture; a novel event anywhere in the stream re-arms it.** This is the scientific case for loop-based, non-developing background music — and against crossfading into a new song with a different character.

### 1.3 Lyrics vs instrumental — verbal working-memory interference

**Vasilev, Kirkby & Angele (2018), *Perspectives on Psychological Science* 13(5):567–597, "Auditory distraction during reading: a Bayesian meta-analysis of a continuing controversy"** — [journal](https://journals.sagepub.com/doi/full/10.1177/1745691617747398), [OA PDF](https://eprints.bournemouth.ac.uk/29995/9/1745691617747398.pdf). 65 studies. Posterior Hedges's *g* for reading comprehension:

| Sound | k | **g** | 95% CrI | P(g<0) |
|---|---|---|---|---|
| All sounds | 54 | **−0.21** | [−0.30, −0.13] | > .99 |
| Noise | 12 | −0.17 | [−0.33, +0.002] | .97 |
| **Speech** | 20 | **−0.26** | [−0.36, −0.17] | > .99 |
| Music | 36 | −0.19 | [−0.34, −0.05] | > .99 |
| Reading speed (all) | 13 | −0.06 | [−0.15, +0.02] | .92 |
| Proofreading accuracy | 7 | −0.14 | [−0.42, +0.04] | .94 |

Metaregression (mean differences):

| Contrast | g | Probability of a true difference |
|---|---|---|
| **Intelligible > unintelligible speech** | **−0.12** | **99 %** |
| **Lyrical > non-lyrical music** | **−0.19** | **95 %** |
| Intelligible speech vs **lyrical music** | — | **54 % — i.e. no difference. Lyrical music is as distracting as an audiobook.** |
| Environmental > acoustical (white/pink) noise | −0.10 | 90 % |
| Non-lyrical music vs acoustical noise | — | **55 % — no difference.** ⚠ *Contrary* to the changing-state prediction |
| Adults vs children | ≈ 0 | 73 % |

Simple effects: **lyrical music g = −0.35; intelligible speech g = −0.34; non-lyrical music ≈ −0.16.** Kämpfe et al. (2010) reading-only subset gives essentially the same: r = −0.11 (d = −0.22).

**Perham & Currie (2014), *Applied Cognitive Psychology* 28:279–284** — [journal](https://onlinelibrary.wiley.com/doi/10.1002/acp.2994), [PDF](https://gwern.net/doc/psychology/music/distraction/2014-perham.pdf). N = 30; SAT reading passages; music at **65–75 dB(A)** over headphones; disliked-track lyric intelligibility pilot-tested at **~75%**:

| Contrast | Result |
|---|---|
| Main effect of sound | **F(3,87) = 8.05, η² = 0.22, p < .05** |
| Quiet > **disliked** lyrical | F(1,29) = 16.96, **η² = 0.37**, p < .001 |
| Quiet > **liked** lyrical | F(1,29) = 10.43, **η² = 0.26**, p < .05 |
| Quiet vs **non-lyrical** | **n.s.** |
| Disliked vs liked lyrical | n.s. — **liking does not protect you** |

**A UX finding that matters more than the effect sizes:** subjective distractibility ratings (η² = 0.62) put liked (75.3) and disliked (78.7) lyrics as *equally* distracting; but subjective *performance* estimates (η² = 0.50) ranked quiet > non-lyrical > liked ≈ disliked. **Users will rate music they love as better for their performance than the data supports.** Dampen's UI should not rely on self-report to tune the amount of damping.

**Martin, Wogalter & Forlano (1988), *Journal of Memory and Language* 27:382–398** ([doi](https://doi.org/10.1016/0749-596X(88)90063-4)) — first systematic test of phonological vs semantic interference in reading: **intelligible background speech > unintelligible speech** in disruption; driven by *semantic* properties; **instrumental music was not more distracting than silence.**

Further: [Ding et al. 2025, L1 vs L2 reading](https://onlinelibrary.wiley.com/doi/10.1002/acp.70104); [lyrics-language and study-habit moderators](https://pmc.ncbi.nlm.nih.gov/articles/PMC11027201/); [eye-movement study with self-selected music, *Sci Rep* 2023](https://www.nature.com/articles/s41598-023-28426-1). ⚠ Contrary result on *verbal learning* (not seriation): [Jäncke & Sandmann, *Behav. Brain Funct.* 2010](https://doi.org/10.1186/1744-9081-10-10) found no vocals-vs-instrumentals difference.

**Interpretation for Dampen:** obliterating lyrics buys roughly **Δg ≈ 0.19** on comprehension — moving from the ~−0.35 band to the ~−0.16 band, roughly halving the disruption. **It does not get you to zero.** And at 75% lyric intelligibility you still get η² = 0.37, so *partial* obscuring may not suffice: target **full unintelligibility**, not merely "hard to make out".

### 1.4 Which frequency bands carry attention-grabbing information

#### ANSI/ASA S3.5-1997 (R2024) band importance functions

Extracted from the ANSI tables shipped in the CRAN `SII` package (`inst/extdata/SII_Constants.xls`, Tables 3, 4, B.2, B.3) — [package](https://cran.r-project.org/web/packages/SII/), [vignette](https://cran.r-project.org/web/packages/SII/vignettes/SII.pdf), [docs](https://rdrr.io/cran/SII/man/critical.html).

**Table 3 — one-third-octave band importance Iᵢ (sums to 1.0), normal-effort speech spectrum level, and free-field→eardrum transfer Fᵢ:**

| Band | f (Hz) | **Iᵢ** | Speech spec. level (dB) | **Fᵢ free-field→eardrum (dB)** |
|---|---|---|---|---|
| 1 | 160 | 0.0083 | 32.41 | 0.0 |
| 2 | 200 | 0.0095 | 34.48 | 0.5 |
| 3 | 250 | 0.0150 | 34.75 | 1.0 |
| 4 | 315 | 0.0289 | 33.98 | 1.4 |
| 5 | 400 | 0.0440 | 34.59 | 1.5 |
| 6 | 500 | 0.0578 | 34.27 | 1.8 |
| 7 | 630 | 0.0653 | 32.06 | 2.4 |
| 8 | 800 | 0.0711 | 28.30 | 3.1 |
| 9 | 1000 | 0.0818 | 25.01 | 2.6 |
| 10 | 1250 | 0.0844 | 23.00 | 3.0 |
| 11 | 1600 | 0.0882 | 20.15 | **6.1** |
| 12 | **2000** | **0.0898** ← max | 17.32 | **12.0** |
| 13 | 2500 | 0.0868 | 13.18 | **16.8** ← max |
| 14 | 3150 | 0.0844 | 11.55 | **15.0** |
| 15 | 4000 | 0.0771 | 9.33 | 14.3 |
| 16 | 5000 | 0.0527 | 5.31 | 10.7 |
| 17 | 6300 | 0.0364 | 2.59 | 6.4 |
| 18 | 8000 | 0.0185 | 1.13 | 1.8 |

Overall speech SPL: normal 62.35 / raised 68.34 / loud 74.85 / shouted 82.30 dB.

**Cumulative importance:**

| Range | Σ Iᵢ | Share of total intelligibility |
|---|---|---|
| 160–400 Hz | 0.1057 | **10.6 %** |
| **500 Hz – 4 kHz** | **0.7867** | **78.7 %** |
| 1.25–4 kHz | 0.4207 | 42.1 % |
| **1.6–3.15 kHz** (4 third-octaves) | **0.3492** | **34.9 %** |
| 5–8 kHz | 0.1076 | 10.8 % |

**Table 4 — octave-band importance:** 250 Hz 0.0617 · 500 Hz 0.1671 · 1 kHz 0.2373 · **2 kHz 0.2648 (max)** · 4 kHz 0.2142 · 8 kHz 0.0549.

**Table B.2 — alternative importance functions matter for music.** Peaks shift by material: nonsense syllables peak at **2500 Hz (0.1120)**; but **Short Passages (connected discourse) peak at 500 Hz (0.0944) and 400 Hz (0.0898)**; CST peaks at 1600 Hz (0.1035). **Sung lyrics are closer to connected discourse than to nonsense syllables, so the 400–630 Hz region matters more for Dampen than the standard SII literature implies.** Table B.3 (octave, Short Passages): 250 Hz 0.1004 / 500 Hz **0.2551** / 1 k 0.1960 / 2 k 0.2322 / 4 k 0.1744 / 8 k 0.0419. Overview: [The Hearing Journal on SII](https://journals.lww.com/thehearingjournal/fulltext/2004/10000/the_speech_intelligibility_index__what_is_it_and.3.aspx).

#### French & Steinberg (1947) — the hardest number in this document

*JASA* 19:90–119, "Factors governing the intelligibility of speech sounds" — [full PDF](https://jontalle.web.engr.illinois.edu/uploads/537.F18/Papers/FrenchSteinberg47.pdf).

| Filter | Syllable articulation |
|---|---|
| Full band | ~98 % |
| **Lowpass at 1000 Hz** | **27 %** |
| Highpass at 1000 Hz (complement) | 89 % |
| LP/HP crossover | **~1900 Hz, where each gives S = 68 %** |
| Lowpass ~950 Hz | ↔ articulation index 0.25 |

Band structure: 20 bands each contributing AI = 0.05. Useful range 250 Hz–4 kHz carries most vowel and consonant cues; 5.7–7 kHz contributes only ~5 %.

> **A brick-wall lowpass at 1 kHz drops nonsense-syllable intelligibility from ~98% to ~27%.** That is the single hardest number available for "make lyrics unintelligible but keep the music present." Note the asymmetry: the *complementary* highpass still gives 89 % — which is why a highpass is useless for this purpose, and why §2.5's telephone preset (300–3400 Hz) is the worst possible choice for focus.

#### Formants

Peterson & Barney (1952), *JASA* 24:175–184 (33 men, 28 women, 15 children) and Hillenbrand et al. (1995) are the normative sets; review with full tables: [Kent & Vorperian 2018 (PDF)](https://web.waisman.wisc.edu/www/vocal/docs/pubs/2018-Kent-Vorperian-Static-Vowel-Formant%20measurements-nihms971733.pdf).

| Formant | Adult male range | Carries |
|---|---|---|
| **F1** | **250–900 Hz** | vowel identity (with F2) |
| **F2** | **600–2500 Hz** | vowel identity; **F2 transitions are the key changing-state carrier** |
| **F3** | **1500–3500 Hz** | timbre; in classical male singing F3–F5 cluster into the "singer's formant" ≈ **2.5–3 kHz** |

Female formants are higher (shorter tract); children's higher still. ([Formant](https://en.wikipedia.org/wiki/Formant))

**The decisive formant experiment** — Viswanathan, Dorsi & George (2013/2014), [journal](https://journals.sagepub.com/doi/10.1177/1747021817739257): sinewave speech (3 sinusoids tracking formant centres) disrupts serial recall as much as natural speech. But **time-reversing 2 of the 3 formant tracks abolished the ISE while preserving the same amount of "changing state"** — ADER 6.0 pp / RDER 15.0 % for reversed sinewave speech vs ~50 % for speech. It is not change per se; it is *speech-like formant trajectories*.

#### The presence region and the ear's own filter

| Finding | Value | Source |
|---|---|---|
| External-ear transfer function peak | **~+20 dB free-field-to-eardrum at 3000 Hz** (~10× pressure) | [cochlea.eu](https://www.cochlea.eu/en/ear/external-ear/) |
| Shaw (1974) average | ~+15 to +17 dB peak near 2.5 kHz ⚠ (could not open primary full text; treat as approximate) | [ref](https://www.semanticscholar.org/paper/df500a9c40978bc32f60859287350630f895e05a) |
| Quarter-wave canal resonance | **2–3 kHz (≈2.7 kHz)**, plus a concha depth mode; combined substantial gain **2–7 kHz**, broad amplification 2–10 kHz | [HRTF](https://en.wikipedia.org/wiki/Head-related_transfer_function) |

> **This is why the ANSI free-field→eardrum column peaks at 16.8 dB at 2500 Hz and 15.0 dB at 3150 Hz. The ear hands you a free +15 to +20 dB boost of exactly the band carrying 35% of intelligibility. Any "muffling" DSP that does not cut 1.6–4 kHz is fighting the ear's own filter and will lose.**

#### Consonant/vowel energy split and sibilance

| Finding | Value | Source |
|---|---|---|
| High-energy regions of speech | **~82 % vowels**; low-energy regions **~92 % consonants** | [DPA Microphones](https://www.dpamicrophones.com/mic-university/background-knowledge/facts-about-speech-intelligibility/) |
| Vowel energy | concentrated **250–2000 Hz** | same |
| Voiced consonants | **250–4000 Hz** | same |
| **Highpass at 500 Hz** | removes most speech *energy* but reduces intelligibility by only **~5 %** | same (consistent with French & Steinberg's HP-1000 = 89 %) |
| **Sibilants** | narrowband noise **5–10 kHz**; /s/ peaks **~8 kHz** | [SFU Sonic Studio](https://www.sfu.ca/sonic-studio-webdav/handbook/Sibilance.html); [fricative phonetics (PDF)](https://kuppl.ku.edu/sites/kuppl/files/documents/publications/Jongman%20OREL%202024%20Phonetics%20of%20Fricatives.pdf) |
| HF energy above 5 kHz is **not** negligible | median discrimination limens in the **8 kHz octave of 5–6 dB** for loud singing (n = 30); in dysarthric speech the **8 kHz octave band's amplitude modulation was the single most predictive band for overall intelligibility** (syllable segmentation cue) | [Monson, Hunter, Lotto & Story 2014, *Front. Psychol.* 5:587](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2014.00587/full); [PMC4214223](https://pmc.ncbi.nlm.nih.gov/articles/PMC4214223/) |

#### Direct answer: the target curve

Synthesising the above (this is inference from the cited numbers, not a single cited prescription):

| Band | Why it matters | **Target attenuation** |
|---|---|---|
| 160–315 Hz | Σ Iᵢ = 0.0617; F1 of low vowels | **leave alone** — carries warmth, little intelligibility |
| 400–630 Hz | Σ Iᵢ = 0.1671; **peak of the connected-discourse importance function**; F1/F2 | **−3 to −6 dB** |
| 800–1250 Hz | Σ Iᵢ = 0.2373; F2 | **−6 to −12 dB** |
| **1.6–4 kHz** | Σ Iᵢ = 0.3492 in 5 bands; F2/F3 transitions; **+12 to +17 dB of free ear gain**; "presence" | **−15 to −24 dB — the single highest-leverage region** |
| 5–10 kHz | Σ Iᵢ = 0.1076; sibilance; 8 kHz-octave AM is the top segmentation cue | **−12 to −20 dB; de-ess hard** |

A **~1 kHz lowpass with a steep tail above 1.6 kHz** approximates French & Steinberg's 27 %-articulation point while retaining ~0.21 of total band importance — the music stays audibly present. **But this only works if you also kill spectral *motion* in the surviving band** (§1.5).

### 1.5 Transients, Zwicker metrics, and what actually predicts distraction

#### Definitions and reference values

| Metric | Unit | Reference definition | Band of sensitivity |
|---|---|---|---|
| Loudness N | sone | 1 kHz sine @ 40 dB = **1 sone** = 40 phon; doubling sone = +10 phon | — |
| **Sharpness S** | **acum** | narrowband noise @ 1 kHz, BW < 150 Hz, **60 dB = 1 acum** (DIN 45692) | HF-weighted above ~15–15.8 Bark |
| **Roughness R** | **asper** | 1 kHz tone, 60 dB, **100 % AM at f_mod = 70 Hz = 1 asper** | f_mod **20–300 Hz**, peak ~70 Hz |
| **Fluctuation strength F** | **vacil** | 1 kHz tone, 60 dB, **100 % AM at f_mod = 4 Hz = 1 vacil** | f_mod < 20 Hz, **bandpass with maximum at 4 Hz** |

Sources: HEAD acoustics [*Psychoacoustic Analyses I*](https://cdn.head-acoustics.com/fileadmin/data/global/Application-Notes/SVP/Psychoacoustic-Analyses-I_e.pdf) and [*II*](https://cdn.head-acoustics.com/fileadmin/data/global/Application-Notes/SVP/Psychoacoustic-Analyses-II_e.pdf); Fastl & Zwicker, *Psychoacoustics: Facts and Models*, 3rd ed., Springer 2007; [what is a vacil](https://www.johndcook.com/blog/2016/07/18/what-is-a-vacil/).

#### Formulas

**Sharpness** ([MathWorks `acousticSharpness`](https://www.mathworks.com/help/audio/ref/acousticsharpness.html)):

```
S = k · ∫₀²⁴ N'(z)·g(z)·z dz  /  ∫₀²⁴ N'(z) dz        [acum]

DIN 45692:     g(z) = 1                                  for z ≤ 15.8 Bark
               g(z) = 0.15·e^(0.42(z−15.8)) + 0.85       for z >  15.8 Bark
von Bismarck:  k = 0.11;  g(z) = 1                       for z ≤ 15 Bark
               g(z) = 0.2·e^(0.308(z−15)) + 0.8          for z >  15 Bark
Aures:         k = 0.11;  g(z) = 0.078·(e^(0.171z)/z)·(N / ln(0.05N+1))
```

**15 Bark ≈ 2500 Hz; 15.8 Bark ≈ 2800 Hz. The sharpness weighting breakpoint sits exactly on the presence region** — cutting 2.5–10 kHz reduces sharpness roughly linearly in energy weight. (Loudness level, DIN 45631: L_N = 40 + 33.22·log₁₀(N/sone) for N ≥ 1 sone.)

**Zwicker–Fastl Psychoacoustic Annoyance** ([derivation](https://www.johndcook.com/blog/2016/07/28/quantifying-how-annoying-a-sound-is/); tonal-noise improvement, [Di et al. 2016](https://www.sciencedirect.com/science/article/abs/pii/S0003682X15003606)):

```
PA   = N₅ · ( 1 + √(w_S² + w_FR²) )
w_S  = (S − 1.75) · 0.25 · log₁₀(N₅ + 10)        for S > 1.75 acum;  0 otherwise
w_FR = (2.18 / N₅^0.4) · (0.4·F + 0.6·R)
```
N₅ = loudness exceeded 5 % of the time (sone), S in acum, F in vacil, R in asper.

> **A concrete, checkable DSP target: w_S = 0 for S ≤ 1.75 acum.** If measured sharpness stays under **1.75 acum**, sharpness contributes *nothing* to the annoyance model. Note also that **roughness carries weight 0.6 vs fluctuation's 0.4** in w_FR — and roughness lives in the 20–300 Hz modulation band, which is exactly where saturation and bitcrush artefacts live. **Lo-fi processing can accidentally make the result more annoying.**

#### The quantitative ISE model

Schlittmeier, Weißgerber, Kerber, Fastl & Hellbrück (2012), *Attention, Perception & Psychophysics* 74:194–203 ([doi](https://doi.org/10.3758/s13414-011-0230-7)):

```
ADER [percentage points] = (F / 0.68 vacil) · 7.5
```

Fitted over **N = 70 datasets** (speech, masked speech, music, animal calls), **R² = 0.55** — one psychoacoustic feature explains 55 % of ISE variance. Worked values: F = 0.68 vacil → ADER 7.5 pp; F = 1.36 → 15 pp; F = 0.1 → 1.1 pp.

> ⚠ **Known failure modes, and they are the ones that matter most here.** Fluctuation strength does not distinguish AM from FM, so it predicts a 4 Hz AM noise should be maximally disruptive — **empirically it is not** (Salamé & Baddeley 1989 Exp.3: ADER 1.2 pp). It also cannot predict the noise-vocoder channel effect, since amplitude fluctuation is present at every channel count. **Do not optimise purely for low vacil.** Speech Transmission Index ([Hongisto 2005, *Indoor Air* 15:458–468](https://doi.org/10.1111/j.1600-0668.2005.00391.x)) also predicts only subsets; Park, Kohlrausch & van Leest (2013, *JASA* 134:1970–1981) found an ad-hoc *spectral-change-between-successive-segments* metric beat STI.

#### Modulation rate: the 4 Hz story, with the caveat

- **Speech is modulated at ~4 Hz (≈4 syllables/s)** and therefore has high fluctuation strength. Measured: **~0.6–0.7 vacil peak** for sentences in quiet; markedly lower for the same sentences spoken in a moving car (background noise reduces envelope modulation depth). HEAD AN *Psychoacoustics II*, Fig. 6.
- **Fluctuation strength is bandpass with its maximum at 4 Hz** — matching the syllabic rate exactly. That is the mechanistic core of "why 4 Hz grabs attention."
- **ISE as a function of FM rate** (Ellermeier & Zimmer 2014, Fig. 2; re-analysis of Wolski 1995, N = 24): FM rates 0, 0.4, 4, 10.5, 50 Hz. Errors vary **non-monotonically**; continuous FM peaks near 4 Hz. **But the best FM sound raised errors only 22.5 % (RDER) vs ~50 % for speech**, and continuous (non-interrupted) FM near 4 Hz produced only **~11 %.**
- **Spectral detail dominates everything else.** Ellermeier, Kattner, Ueda, Doumoto & Nakajima (2012), noise-vocoded German speech, N = 20 Japanese listeners (Fig. 3): errors were **unaffected vs silence with 1 or 2 vocoder bands**, and **roughly doubled** with 4 or 20 bands or unprocessed speech. **1-band noise-vocoded speech = pure speech-shaped amplitude modulation = no ISE.**

> **This is the most important finding in this entire document for Dampen.** Speech-envelope amplitude modulation alone is harmless. It is the **number of independently-moving spectral channels** that does the damage. Collapse the spectrum to **1–2 effective channels** in the speech band — heavy band-limiting plus spectral smearing — and the irrelevant-sound effect goes to zero *even with the amplitude envelope fully intact*.

#### Onsets and transients

| Finding | Value | Source |
|---|---|---|
| Typical natural sound-onset rise times | **2.5–20 ms** | [Springer](https://link.springer.com/article/10.3758/s13414-015-0940-3) |
| Behavioural time course of capture | in metronome tapping, **tempo speeds up ~750 ms after distractor onset**, dying out by **~1750 ms**. Both sound onsets *and* pitch shifts of a continuous background do this | [Springer](https://link.springer.com/article/10.3758/s13423-023-02305-2) |
| Roughness band | envelope variations **20–300 Hz** read as "rough"; > ~300 Hz you hear separate tones; < ~20 Hz you hear fluctuation | HEAD AN II |
| Real-world roughness magnitudes | "ok" motor R = 0.048 asper; "not ok" motor R = 0.16 asper — vs the 1 asper synthetic reference | HEAD AN II |

**Design implication: attack envelopes longer than ~50 ms on every onset, and no pitch *steps* in the surviving band, reduce capture.**

### 1.6 Dynamic range and loudness variation — where the evidence is weaker than you'd expect

**Honest summary: the evidence that compressed/steady loudness reduces *cognitive* distraction is weak-to-absent; the evidence that it reduces *annoyance* is strong.** Two different dependent variables; sources disagree.

**Loudness JND:** ~**1 dB** for a typical tone at moderate level; intensity-discrimination thresholds generally **0.5–1 dB**; the "near-miss to Weber's law" means ΔI/I decreases with level. Wier, Jesteadt & Green (1977), *JASA* 61:178–184 ([doi](https://doi.org/10.1121/1.381251)); Jesteadt, Wier & Green (1977), *JASA* 61:169–177; [overview](https://www.britannica.com/science/intensity-just-noticeable-difference).

**Modulation-depth noticeability and the annoyance penalty:**

| Finding | Value | Source |
|---|---|---|
| **AM becomes noticeable above ~2–3 dB modulation depth** | noticeable > 2 dB; readily sensed > 3 dB | wind-turbine literature |
| At 2.0 Hz modulation, deepest depth tested | level had to be **reduced by 12.9 dB** for the modulated noise to be judged equally annoying as an unmodulated reference | [ResearchGate](https://www.researchgate.net/publication/299402636_Effect_of_modulation_depth_frequency_and_intermittence_on_wind_turbine_noise_annoyance) |
| LF noise modulation | annoyance adjustment **up to 17 dB** | [Leventhall, *Noise & Health* 2004](https://journals.lww.com/nohe/fulltext/2004/06230/low_frequency_noise_and_annoyance.6.aspx) |

**But for serial recall specifically, level and AM do essentially nothing:**

| Study | Manipulation | Result |
|---|---|---|
| **Tremblay & Jones 1999, *JEP:HPP* 25:1005–1015** — "Change of intensity fails to produce an irrelevant sound effect" | changing level | **ADER 2.2 pp, RDER 5.9 %** ([record](https://psycnet.apa.org/record/1999-01095-013)) |
| **Jones et al. 1992 Exp.2b** | AM noise | **ADER −1.1 pp** — numerically *better* than quiet |
| **Ellermeier & Hellbrück 1998** | overall level | does not modulate ISE magnitude |

**Background-music absolute level and task performance** (a separate, noisier literature):

| Finding | Source |
|---|---|
| SPL **≥ 60 dBA significantly impaired auditory working memory; no differences at 40 or 50 dBA** | [*Building & Environment* 2024](https://www.sciencedirect.com/science/article/abs/pii/S0360132324011557) |
| ⚠ Claimed inverted-U with ~70 dB optimal for *simple* tasks; degradation above 80 or below 60 dB | [Wolfe 1983, *J. Music Therapy*](https://journals.sagepub.com/doi/10.2307/3345172) — **weak secondary sourcing, contradicted by the above. Do not build on it.** |

**Practical synthesis for Dampen.** Keep macro-dynamics below the **~2–3 dB AM-noticeability threshold** in the fluctuation-sensitive band (< 20 Hz, especially around 4 Hz) — this is justified by the *annoyance* literature and by capture-suppression, **not** by interference-by-process. Do not claim compression reduces verbal interference; the level/AM data says it doesn't. Playback level around **45–55 dBA** is the defensible recommendation: below the 60 dBA working-memory impairment threshold, and far under Salamé & Baddeley's 75 dB(A) experimental level.

This also justifies Dampen's `drift` parameter being **small**: slow gain breathing should sit at or below ~2 dB peak deviation and well below 0.5 Hz, so it never enters the 4 Hz fluctuation peak.

### 1.7 Mozart effect — stated plainly

**Rauscher, Shaw & Ky (1993), *Nature* 365:611** ([link](https://www.nature.com/articles/365611a0)): N = 36 college students, 10 min of Mozart **K. 448** (two-piano sonata in D), **+8 to +9 IQ points** on Stanford–Binet spatial subtests vs relaxation tape or silence; lasting ~10–15 min. (Note: the sonata is K. 448, not K. 488 — Perham & Currie 2014 misprints it.)

**Chabris (1999), *Nature* 400:826–827, "Prelude or requiem for the 'Mozart effect'?"** ([full PDF](https://www.chabris.com/Chabris1999a.pdf)):

| Analysis | Result |
|---|---|
| 16 studies, 20 Mozart-vs-silence comparisons, **N = 714** | **pooled d = 0.09 ≈ 1.4 IQ points. Not significant: Z = 1.14, P = 0.26** |
| Abstract reasoning | **d = −0.04** |
| Spatial–temporal processing | d = +0.14 (≈2.1 IQ points) |
| Mozart vs *relaxation instructions* (8 comparisons, N = 201) | d = 0.20 overall; d = 0.56 spatial–temporal — but relaxation instructions *lower* arousal, inflating the apparent benefit |
| Individual comparisons | d = −0.989 to +1.389; **only 2 of 28 reached p < .05** |

Chabris's verdict: a small, intermittent "enjoyment arousal" effect confined to visual-transformation tasks, "smaller than the average variation of a single person's IQ-test performance." Failed replications: Steele, Bass & Crook (1999), *Psychol. Sci.* 10:366–369; Nantais & Schellenberg (1999), *Psychol. Sci.* 10:370–373 — who found **Mozart *and* a Stephen King story both improved paper-folding, but only for participants who enjoyed what they heard.** Hallam: **8,120 British schoolchildren performed better on popular music than on Mozart.**

**Pietschnig, Voracek & Formann (2010), *Intelligence* 38:314–323, "Mozart effect–Shmozart effect: a meta-analysis"** ([link](https://www.sciencedirect.com/science/article/abs/pii/S0160289610000267)): ~39 studies, **104 independent samples, > 3,000 participants.**

| Contrast | d | p |
|---|---|---|
| Mozart vs no-stimulus / non-musical stimulus | **0.37** [0.23, 0.52] | — |
| **Mozart vs other music** | **0.15** | .02 |
| Mozart vs nothing | 0.38 | < .01 |

**Almost all of the effect is music-vs-nothing, not Mozart-vs-other-music.** Publication bias substantially inflates the estimates, and **studies from Rauscher-affiliated labs showed systematically larger effects.** Conclusion: "little evidence for a specific, performance-enhancing Mozart effect." Confirmed by the 2023 multiverse meta-analysis, [*Sci Rep* 13:3175, "Unfounded authority, underpowered studies, and non-transparent reporting perpetuate the Mozart effect myth"](https://www.nature.com/articles/s41598-023-30206-w).

**The real mechanism — arousal and mood.** Thompson, Schellenberg & Husain (2001), *Psychological Science* 12:248–251 ([doi](https://doi.org/10.1111/1467-9280.00345)): spatial task after Mozart (fast, major, pleasant, energetic), Albinoni's Adagio (slow, minor, sad), or silence. **Performance improved only after Mozart, and the advantage was fully mediated by enjoyment, arousal and mood.** Companion: Husain, Thompson & Schellenberg (2002), *Music Perception* 20:151–171 — tempo → arousal; mode → mood ([PDF](https://sites.utm.utoronto.ca/sites/sites.utm.utoronto.ca.glenn_website/files/download/Husain.pdf)).

**Statement of the evidence: there is no Mozart-specific effect.** There is a small, short-lived, task-specific arousal/mood effect (d ≈ 0.1–0.4, publication-bias-inflated, ~1–2 IQ points at most, confined to mental-rotation-type tasks) that any sufficiently enjoyable stimulus — including a Stephen King audiobook — can produce. **For a reading product this literature offers nothing: §1.1–1.3 (interference *during* the task) dominates arousal effects *before* the task.** Do not make Mozart-effect claims in Dampen's marketing.

### 1.8 Eno, Satie, Muzak — design principles that are actually mechanisms

#### Eno, *Ambient 1: Music for Airports* (EG/Polydor, September 1978)

The liner-note definition, verbatim:

> **"Ambient Music must be able to accommodate many levels of listening attention without enforcing one in particular; it must be as ignorable as it is interesting."**

Also: ambient music "is intended to induce calm and a space to think," and should "enhance" rather than "blanket" the acoustic environment — explicitly contrasted with Muzak. ([Wikipedia](https://en.wikipedia.org/wiki/Ambient_1:_Music_for_Airports); [uDiscover](https://www.udiscovermusic.com/stories/brian-eno-music-for-airports-feature/); [liner notes transcript](https://www.scribd.com/document/236445226/Brian-Eno-Music-for-Airports-Liner-Notes))

**The actual compositional techniques, per track:**

| Track | Duration | Technique |
|---|---|---|
| "1/1" | 16:30 | piano loops in arrhythmic patterns; **the only track with melody** |
| "2/1" | 8:20 | **tape loops of vocal notes cut to different lengths**, drifting in and out of coincidence |
| "1/2" | 11:30 | same technique — the structure *is* the slow phase relationship between incommensurate loop periods |
| "2/2" | 6:00 | ARP 2600 synthesiser with three echo units |

Across the album: **no rhythm section, no melodic hooks, no distinct melodic or harmonic development, long note durations, irregular repetition.**

#### Satie — *musique d'ameublement* (1917)

Prompted by having a restaurant meal ruined by loud music:

> **"We must bring about a music which is like furniture — a music, that is, which will be part of the noises of the environment, will take them into consideration. I think of it as melodious, softening the noises of the knives and forks, not dominating them, not imposing itself."**

Form: **short passages with an indefinite number of repeats.** No development, no climax, no cadential arrival. ([Wikipedia](https://en.wikipedia.org/wiki/Furniture_music); [Far Out](https://faroutmagazine.co.uk/furniture-music-how-erik-satie-created-ambient-music-way-back-in-1917/); Lanza, *Elevator Music*, Univ. Illinois Press 2014 — [excerpt](https://www.academia.edu/11283606/))

#### Muzak — "Stimulus Progression" (late 1940s)

| Feature | Detail |
|---|---|
| Programme structure | **15-minute blocks of music alternating with 15 minutes of silence** — company research claimed this limited listener fatigue and increased the stimulus effect |
| Track classification | every track assigned a numerical **"stimulus value" from 2 to 6**, based on tempo and instrumentation |
| Within-block shape | **ascending** in tempo, loudness and brassiness, targeted at the late-morning and mid-afternoon productivity lulls |

([Wikipedia](https://en.wikipedia.org/wiki/Muzak); [Mental Floss](https://mentalfloss.com/article/599680/muzak-facts); [History of Muzak](https://historyofmuzak.org/environmental); sceptical take: [Skeptoid 370](https://skeptoid.com/episodes/370) — the productivity claims were never well evidenced.)

#### Translation to DSP and arrangement

Mapping each historical technique onto the mechanism it defeats (this mapping is synthesis, not a cited claim):

| Technique | Mechanism it defeats | Evidence |
|---|---|---|
| No lyrics / unintelligible vocals | Semantic interference | §1.3: Δg ≈ 0.19; §1.1: 14.2 pp → 4.8 pp |
| No rhythm section, no sharp onsets | Attentional capture by abrupt onsets | §1.5: natural onsets 2.5–20 ms; capture peaks ~750 ms post-onset |
| Long note durations, slow phasing | Moves spectral change out of the 4 Hz fluctuation-strength peak | §1.5 |
| **Loops of incommensurate lengths** | Maximises predictability-per-event while avoiding exact repetition ⇒ minimises the deviation effect | §1.2: capture requires *expectancy violation* |
| No melodic hooks, no harmonic development | Removes the "changing state" pointers for interference-by-process | §1.2 |
| Satie's "indefinite repeats" | Steady-state ≈ quiet | §1.2: .64 vs .67 |
| Muzak's 15-on/15-off silence cycle | ⚠ **Nothing in the ISE literature supports this** (the ISE does not habituate). Plausible as arousal reset; treat as unsupported folklore | — |
| Muzak's ascending stimulus value | ⚠ **The opposite of what Dampen wants** — designed to *increase* arousal and physical pace, not to protect reading | — |

**Concrete Dampen implications:** (a) favour loop-based, non-developing source material where the user has the choice; (b) never crossfade abruptly into a track with a different spectral character — that is a deviant; (c) make the `drift` LFO rate incommensurate with any musical period so it never becomes a predictable event *or* an exact repetition.

### 1.9 Lo-fi hip hop / study beats — what the literature does and does not support

#### The academic work that exists (it is thin)

**Winston & Saywood (2019), "Beats to Relax/Study To: Contradiction and Paradox in Lo-Fi Hip Hop," *IASPM Journal* 9(2):40–54** — [full PDF](https://iaspmjournal.net/index.php/IASPM_Journal/article/download/949/pdf_1). Production conventions from their own sampling:

| Convention | Value |
|---|---|
| **Tempo** | **70–85 BPM** |
| Vocals | **rarely any rapping; sung vocals rare.** Where vocals appear they are samples, often from non-musical sources |
| Rhythm | **unquantized** (the J Dilla lineage) — deliberately loose timing |
| Dynamics | **sidechain compression**: kick or bass triggers ducking of the overall track amplitude |
| Spectrum | **deliberate lowpass filtering of samples to remove high frequencies**, plus a layered **vinyl crackle** (iZotope Vinyl named as the common tool); cassette hiss samples |
| Instrumentation | electric piano, esp. Fender Rhodes; jazz-record loops |

Case study: Eevee, "I wonder if we're dead" — primary loop sampled from *The Legend of Korra* soundtrack, **passed through a lowpass to remove most high frequencies**, producing a "muted and softened" character.

**Hodgson (2021), "Lo-fi Today," *Organised Sound*, Cambridge UP** — [link](https://www.cambridge.org/core/journals/organised-sound/article/lofi-today/73B4DDB240C2B2DC0A0E64249AB44325) — the only source found with actual spectral analysis:

| Track | Findings |
|---|---|
| Glimlip, "Floating Away" | **80 BPM**, I–IV–vi–V in G; **highpass during the breakdown** to fake an old radio; **a piano run through a lowpass rolling off "around 800 Hz"**; **vinyl noise functions as a "spectral filler" layer occupying mid-high frequencies**; guitar centred, vinyl static in the sides, reverberated piano for depth |
| Amulets, "Where the Land Meets the Sea" | **cassette loop ≈ 5 s (22 cm of tape around the reels)**; I–V–vi–IV in A; narrow mid-range opening expanding over time; **high frequencies rolled off by media decay**; volume-pedal swells, tremolo |

Thesis: lo-fi's "low fidelity" signifiers are the product of deliberate craft, not primitiveness. The **800 Hz lowpass figure independently converges on French & Steinberg's 1 kHz / 27 %-articulation point** — producers found the right number by ear.

Also: [In and Out of Flow: Lo-Fi Study Beats and Their "Impactive" Qualities](https://escholarship.org/content/qt19q032sh/qt19q032sh_noSplash_f4011dd9661cef68ebcc93b3dc2481aa.pdf) (exploratory, under-powered — do not treat as evidence); Gamble's COVID-era ethnography, [part 1](https://digitalflo.ws/lofi/) and [part 2](https://stevengamble.com/lofi2/).

#### The one experiment

**Kirk et al. (2022), "Effects of three genres of focus music on heart rate variability and sustained attention," *Journal of Cognitive Enhancement* 6(2):143–158** — [link](https://link.springer.com/article/10.1007/s41465-021-00226-3):

- **120 healthy adults**, four groups: jazz, piano, lo-fi, no-music control.
- SART performance differed between the three music groups and the control; attentional capacity increased from baseline in all three music groups, **not** in the control. Increased **RMSSD** (parasympathetic) in the music groups. Effect larger *during* exposure than after.
- **No differential effect across the three genres** — lo-fi was no better and no worse than jazz or piano.
- ⚠ Caveat: the task is sustained attention, not reading comprehension or serial recall. Nothing here contradicts §1.1–1.3.

#### Claims that appear to be fabricated

Several commercial and blog sources cite "a 2019 study in *Psychomusicology: Music, Mind, and Brain* finding increased alpha and lower stress at 80 BPM" and "a 2017 *PLOS ONE* study finding 60–80 BPM produced the highest sustained attention scores." **Neither study could be located. Treat both as false.** The nearest real finding:

**de Witte, Spruit, van Hooren, Moonen & Stams (2020), "Effects of music interventions on stress-related outcomes: a systematic review and two meta-analyses," *Health Psychology Review* 14(2):294–324** — [link](https://www.tandfonline.com/doi/full/10.1080/17437199.2019.1627897) — reports **music at 60–80 BPM yielding larger effects than other or unspecified tempos** on psychological stress outcomes. Cite this, not the phantoms.

#### Verdict

**There is no academic literature establishing that lo-fi hip hop aids reading or studying.** What exists is musicological description, one 120-person study showing it helps sustained attention no more than jazz or piano, and cultural-studies analysis. **However, the production conventions align well with the ISE evidence** — 70–85 BPM, no intelligible vocals, aggressive lowpass filtering, sidechain-compressed macro-dynamics, short repeating loops, and vinyl noise acting as a steady-state spectral filler that masks spectral change. **That alignment is a plausible mechanism, not a demonstrated one.** Dampen is, in effect, an automated lo-fi producer — which is a defensible design stance, provided the marketing does not claim a cognitive benefit that the literature has not shown.

### 1.10 ASMR — and a direct conflict with this product

**Poerio, Blakey, Hostler & Veltri (2018), *PLOS ONE* 13(6):e0196645** — [full text](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0196645):

*Study 1* (online, N = 1,002; 813 = 81 % ASMR-experiencers): tingle frequency vs baseline — sound-based ASMR **M_diff = 1.38 [1.13, 1.63], g = 0.89**; spoken ASMR **M_diff = 1.63 [1.38, 1.88], g = 1.04**; control videos M_diff = 0.28, g = 0.31. Group × video interaction **F(2,2000) = 58.54, p < .001, η² = .06.**

*Study 2* (lab, n ≈ 110): **heart rate F(1,106) = 4.95, p = .028, ηp² = .05**; ASMR participants **−3.41 bpm, d = 0.39**. **Skin conductance F(1,105) = 5.92, p = .017, ηp² = .05**; ASMR participants **+0.30 μS, d = 0.17**.

**Barratt & Davis (2015), *PeerJ* 3:e851** — [link](https://peerj.com/articles/851/): N = 475 recruited from ASMR communities. Top triggers: **whispering 75 %**, personal attention 69 %, crisp sounds 64 %, slow movements 53 %.

**What the ASMR literature does NOT support:**

1. **No ASMR study in this set measured focal-task performance.** Zero evidence of cognitive benefit.
2. **It is not simple relaxation.** HR *down* but SCL *up* — the authors explicitly conclude ASMR is "also an arousing (but not sexual) experience."
3. **Physiological effect sizes are small** (d = 0.39 HR; **d = 0.17 SCL**) from a sample the authors state "was not based on an a priori power analysis."
4. **Expectancy confound, acknowledged by the authors.** ASMR participants knew what to expect; non-ASMR participants did not.
5. **It only works for ASMR-experiencers**, and both samples were drawn from ASMR communities — massive selection bias, no prevalence estimate.
6. > **The direct conflict: whispering — the #1 trigger at 75 % — is precisely the stimulus class that maximally disrupts serial recall** (speech: RDER ~50 %, the largest category in §1.1's table). **ASMR and non-distracting study audio are in mechanistic opposition. Do not ship whispered content as a focus feature.**

Complicating follow-ups: [qualitative](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0277962); [pupillometry](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0226692); [high synaesthesia comorbidity](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9558233/).

### 1.11 Soundscape research / ISO 12913 — independent convergence

**The standards:** ISO 12913-1:2014 (framework), ISO/TS 12913-2:2018 (data collection, the 8-item PAQ), ISO/TS 12913-3:2019 (analysis, the circumplex projection) — [Part 3 public draft (PDF)](https://cdn.standards.iteh.ai/samples/86955/869167dd32c943e3aca1c73ba5606004/ISO-DTS-12913-3.pdf). Lineage: Axelsson, Nilsson & Berglund (2010), *JASA* 128:2836–2846 ([doi](https://doi.org/10.1121/1.3493436)).

**Eight PAQ attributes in four opposing pairs at 45° spacing:** pleasant–annoying (0°/180°), eventful–uneventful (90°/270°), vibrant–monotonous (45°/225°), calm–chaotic (315°/135°).

**Projection formulas** ([Mitchell 2025, PDF](https://drandrewmitchell.com/posts/2025-04-03_iso-transform-formulas/circumplex-formulae.pdf)):

```
ISO direct-differences method:
P = (p − a) + cos45°·(ca − ch) + cos45°·(v − m)
E = (e − u) + cos45°·(ch − ca) + cos45°·(v − m)
normalise to [−1,+1] by ±(4 + √32) = ±9.6569 on a 5-point Likert scale

SATP generalised trigonometric form (handles non-45° angles):
P_ISO = (1/λ_Pl) · Σᵢ₌₁⁸ cos(θᵢ)·ξᵢ        λ_Pl = (ρ/2) · Σ |cos(θᵢ)|
E_ISO = (1/λ_Ev) · Σᵢ₌₁⁸ sin(θᵢ)·ξᵢ        λ_Ev = (ρ/2) · Σ |sin(θᵢ)|
θᵢ = attribute angle, ξᵢ = score, ρ = response range (ρ = 4 for a 5-point scale)
```
⚠ Known failure: with unevenly clustered angles (e.g. the Indonesian translation) the SATP normalisation can produce coordinates outside [−1, 1].

| Quadrant | Pleasantness | Eventfulness | Label |
|---|---|---|---|
| +P, +E | pleasant | eventful | vibrant / exciting |
| −P, +E | annoying | eventful | **chaotic** |
| −P, −E | annoying | uneventful | monotonous / boring |
| **+P, −E** | **pleasant** | **uneventful** | **calm ← the target** |

**Natural sounds (water, birds, wind) drive pleasantness up; technological/traffic sounds drive it down; human sounds drive eventfulness up** (Axelsson et al. 2010; [large-sample replication](https://www.biorxiv.org/content/10.1101/2020.10.16.341834)).

> **The convergence worth noting: "calm" means pleasant *and uneventful* — low event density, not merely low level.** The soundscape literature arrives independently at the same conclusion as the ISE literature: **it is the rate of discriminable events, not loudness, that costs you.** Two separate fields, two separate methodologies, same answer. That is the strongest form of evidence available here.

Tooling: [Soundscapy](https://soundscapy.readthedocs.io/en/latest/tutorials/1_Understanding_Soundscape_Analysis/); [analysis guidance](https://pubs.aip.org/asa/jel/article/2/3/037201/2845750/); [Bayesian circumplex models](https://pubs.aip.org/asa/jasa/article/160/2/925/3400234/).

### 1.12 Where the evidence is weak or sources disagree

1. **Does non-lyrical music hurt reading at all?** Vasilev et al. 2018: music overall g = −0.19, P(g<0) > .99 — yes, slightly. Perham & Currie 2014 and Martin et al. 1988: quiet vs non-lyrical n.s. — no. **Resolution:** the meta-analytic effect is real but small (~g = −0.16), too small for individual N≈30 studies to detect.
2. **The changing-state hypothesis fails for reading.** Vasilev et al.: environmental > acoustical noise (90 % probability, consistent) but **non-lyrical music ≈ acoustical noise (only 55 % probability of a difference) — inconsistent**, since music has far more acoustic variation than white noise. No current theory accounts for all the reading-task findings.
3. **Does the ISE habituate?** Ellermeier & Zimmer 2014 say no (citing Hellbrück et al. 1996). [Röer et al. 2014, *Mem. Cogn.*](https://link.springer.com/article/10.3758/s13421-013-0381-y) report evidence that it does. Contested.
4. **Does level matter?** Ellermeier & Hellbrück 1998: no. [Hogrefe 2022 preregistered replication](https://econtent.hogrefe.com/doi/10.1027/1618-3169/a000554): yes. Unresolved — though Dampen's design does not depend on the answer, since it does not rely on level.
5. **Fluctuation strength as a predictor:** R² = 0.55 is strong for one feature but **systematically wrong in the direction that matters most here** — it predicts 4 Hz AM noise should be maximally disruptive; empirically ADER = 1.2 pp. Do not optimise purely for low vacil.
6. **Sharpness breakpoint:** given as z ≤ 15.8 Bark in MathWorks' documentation of DIN 45692 and as z ≤ 15 Bark in several summaries (the latter is von Bismarck's). Check DIN 45692 itself before building a validator.
7. **"70 dB is optimal for background music"** is sourced only to weak secondary material and is contradicted by a 2024 *Building & Environment* study showing impairment at ≥ 60 dBA. Do not use.
8. **Lo-fi's two most-cited "scientific" supports appear not to exist** (§1.9).
9. **Perham & Currie 2014** uses N = 30 with a single thrash-metal track as both the "disliked lyrical" and "non-lyrical" stimulus — genre and lyric presence are not fully crossed, and η² = 0.37 from N = 30 is almost certainly inflated.
10. **Muzak's productivity claims and the 15-on/15-off cycle are corporate research, never independently replicated.**
11. **ASMR has zero evidence of cognitive benefit**, and its top trigger is the maximally disruptive stimulus class for verbal working memory.

### 1.13 The four highest-confidence engineering targets

Ranked by strength of the evidence behind them. These drive every preset in §8.

| # | Target | Evidence | Dampen parameter |
|---|---|---|---|
| **1** | **Collapse spectral detail to ≤ 2 effective channels in the speech band.** Spectral smearing and heavy band-limiting beat envelope manipulation by a wide margin. | Ellermeier et al. 2012 noise-vocoder: **1 or 2 bands = no ISE vs silence; 4 or 20 bands ≈ doubled error rate** | `lowpass` (low cutoff, multiple stages) + `reverb.damping` + `width → 0` |
| **2** | **Lowpass around 1 kHz with a steep tail above 1.6 kHz.** Removes 0.79 of total ANSI band importance while leaving bass/low-mid audibly present; also drops Zwicker sharpness below the 1.75 acum dead-zone. | French & Steinberg: **LP-1000 → 27 % syllable articulation** vs 98 % full-band | `lowpass.freq` ≈ 700–1100, `lowpass.stages` 2–4 |
| **3** | **Remove or obliterate lyrics — target full unintelligibility, not partial.** | Vasilev et al.: Δg = 0.19. Salamé & Baddeley: 14.2 → 4.8 pp. **But 75 %-intelligible lyrics still gave η² = 0.37** | `lowpass` + `presenceDip` at 2–3 kHz |
| **4** | **Lengthen onsets and suppress deviants.** | Natural onsets 2.5–20 ms; capture peaks ~750 ms post-onset, dies by ~1750 ms; deviation effects d = 0.93–1.22 and add ~4 pp | `compressor` (fast attack, high ratio), `reverb.preDelay`, predictable `drift` |

**Do NOT expect gains from:** turning the volume down (level-independence of the ISE); compressing macro-dynamics *for cognitive reasons* (AM alone: ADER 1.2 to −1.1 pp — compress for annoyance and capture, not for interference); Mozart or classical repertoire (d ≈ 0.09–0.37, bias-inflated, arousal-mediated, wrong task); binaural beats (§3.7); or ASMR/whispered material (actively counterproductive).

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
| Lowpass | cutoff / slope / Q | **800 Hz**, 12 dB/oct, **Q = 0.7071 linear** (Butterworth, no ringing) — ⚠ Web Audio wants this as **`Q.value = −3.0103` dB**, see §5.1.4 |
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

## 3. Perceptual masking with noise beds

> **Legal constraint, carried forward from §6.7:** adding a noise bed to Spotify audio violates Spotify Developer Policy §III — *"Do not permit any device or system to segue, mix, re-mix, or overlap any Spotify Content with any other audio content."* Everything in this section applies to **the local-file / user-audio / CC-catalogue path**, which is a first-class path in Dampen. On the Spotify path, `ambience.kind` must be `'none'`.

### 3.1 Noise colours — exact slopes

Terminology matters here and is widely botched. **PSD** = power spectral density, per Hz. A PSD slope of −3 dB/oct means per-octave *band energy* is flat, because constant-percentage-bandwidth bands get wider as frequency rises (+3 dB/oct), cancelling the −3.

| Colour | PSD ∝ | α in 1/f^α | **PSD slope dB/oct** | PSD slope dB/decade | Per-octave band energy |
|---|---|---|---|---|---|
| White | f⁰ | 0 | **0** | 0 | +3 dB/oct |
| Pink | 1/f | 1 | **−3.01** | −10 | 0 (flat) |
| Brown / red | 1/f² | 2 | **−6.02** | −20 | −3 dB/oct |
| Blue / azure | f | −1 | **+3.01** | +10 | +6 dB/oct |
| Violet / purple | f² | −2 | **+6.02** | +20 | +9 dB/oct |
| Grey | inverse equal-loudness contour | n/a | level-dependent | — | equal *loudness* per band |
| Black | f^−α, α > 2 | > 2 | < −6 | < −20 | — |

Sources: [Wikipedia, Colors of noise](https://en.wikipedia.org/wiki/Colors_of_noise); [MATLAB `colorednoise` (1/\|f\|^α)](https://www.mathworks.com/help/dsp/ref/colorednoise.html); [sciencenotes.org](https://sciencenotes.org/colors-of-noise-white-pink-brown-and-more/).

**Grey noise has no canonical spectrum** — "since equal-loudness curves depend not only on the individual but also on the volume at which the noise is played back, there is no one true grey noise" ([Wikipedia, Grey noise](https://en.wikipedia.org/wiki/Grey_noise)). For Dampen, grey = white filtered by the inverted ISO 226 contour **at the actual playback phon level** (§4.2 table).

### 3.2 Which colour for concentration — the honest answer

| Claim | Evidence | Quality |
|---|---|---|
| White/pink noise improves task performance in ADHD / high-attention-problem youth | **g = 0.249, 95% CI [0.135, 0.363], p < .0001** (k = 13, N = 335) | **Meta-analysis**, minimal heterogeneity, no publication bias detected — [Nigg et al. 2024, JAACAP](https://pubmed.ncbi.nlm.nih.gov/38428577/) |
| White/pink noise **harms** performance in non-ADHD controls | **g = −0.212, 95% CI [−0.355, −0.069], p = .0036** (k = 11, N = 335) | Same meta-analysis |
| **Brown noise** helps focus | **Zero studies exist.** The 2024 review identified no brown-noise studies at all. | ⚠ Entirely anecdotal; extrapolated from white/pink data |
| Pink noise improves sleep | Reduced EEG complexity, longer stable sleep; one study found sleep-onset latency −9.5 min at 60 dB continuous pink noise — in **n = 4** | ⚠ Tiny n, no large replication — [Sleep Foundation](https://www.sleepfoundation.org/noise-and-sleep/pink-noise-sleep) |
| Closed-loop pink-noise *bursts* phase-locked to slow oscillations deepen SWS and improve recall | Papalambros et al. 2017, ~3× word recall in older adults | Real, but **phase-locked bursts requiring real-time EEG** — does not transfer to a passive bed |
| Environmental noise as a general cognitive enhancer | WHO systematic review found effects mainly for *aircraft noise harming children's reading*; no support for noise as an enhancer in general populations | Good — [PMC5858354](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5858354/) |

**So the single most important fact about noise and concentration is an interaction, not a main effect:** noise helps people with attention difficulties and *hurts* people without them. The two meta-analytic effect sizes above have opposite signs. Any product claim of the form "noise improves focus" is false for roughly half the population.

#### Stochastic resonance / Moderate Brain Arousal (MBA)

Sikström & Söderlund's MBA model: external noise raises internal neural noise; stochastic resonance at a threshold nonlinearity improves signal detection; the SR curve is **right-shifted in low-dopamine (ADHD) individuals**, so they need more external noise for optimal arousal. Inverted-U predicted: "moderate noise is beneficial, both excessive and insufficient noise is detrimental" ([Söderlund & Sikström, ICBEN 2008, PDF](https://www.icben.org/2008/PDFs/Soederlund_Sikstroem.pdf)).

**The actual levels used:**

| Study | Noise | Signal | SNR | Result |
|---|---|---|---|---|
| Söderlund et al. 2007 Study 1, n = 42 (21 ADHD / 21 ctrl), 9.4–13.7 y | **white 81 dB L_eq** | 80 dB | **−1 dB** | Noise × group F(1,33) = 5.73, p = .023, η² = .15 (unmedicated) |
| Study 2, n = 32, 10–12 y | **white 78 dB** | 86 dB | **+8 dB** | F(1,30) = 5.92, p = .021, η² = .14; the 3.67-point group gap in silence (p = .001) **vanished** under noise |
| Study 3, n = 51, 11–12 y | **white 78 dB** | 86 dB | +8 dB | p = .011 (attention grouping) |
| [Söderlund et al. 2010, *Behav Brain Funct* 6:55](https://behavioralandbrainfunctions.biomedcentral.com/articles/10.1186/1744-9081-6-55) | **white 78 dB** vs silence | — | — | Improved for inattentive, **worsened** for attentive; eliminated the group difference |
| [Baijot/Söderlund et al. 2014, *PLoS ONE* 9:e112768](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0112768), **n = 90** | **65 / 75 / 85 dB** | — | — | Sub-attentive EF improved 65→75 dB: F(2,66) = 7.39, p = .001. Super-attentive **declined**: F(2,46) = 4.42, p = .018. **But: "the shift from moderate to high levels of WN had little further effect on performance in any group"** — the predicted inverted-U was *not* observed. |

> **Two disagreements to state plainly.** (1) The *interaction* (helps low-attention, hurts high-attention) replicates robustly and is the best-supported finding in this literature. The *level optimum* / inverted-U does **not** replicate. (2) **Every level in this literature (78–85 dB) is above every hearing-safety guideline for sustained use (§4.3).** You cannot ship them. Dampen's noise bed operates 25–35 dB below the levels these studies used, so none of these effect sizes transfer quantitatively.

See also [PMC11585357, "Sensory white noise in clinical ADHD: who benefits from noise, and who performs worse?"](https://pmc.ncbi.nlm.nih.gov/articles/PMC11585357/).

### 3.3 The masking level relationship — how much noise, at what level

This is the most directly transferable number set available, and it comes from office sound masking, not from the focus literature.

#### The NRC optimum masking spectrum

Per Bradley, NRC report **NRCC-46274** ("Acoustical Design of Conventional Open Plan Offices", *Canadian Acoustics* 27(3), 2003), reproduced in the [Soft dB architectural specification (PDF, Table 1)](https://www.softdb.com/_files/_sound_masking_division/Documentation/Architectural_Specifications/SoftdB-Sound-Masking-System_Architectural_Specifications_202007.pdf):

| 1/3-oct centre (Hz) | dB (at 45 dBA overall) | | 1/3-oct centre (Hz) | dB |
|---|---|---|---|---|
| 100 | 42.5 | | 800 | 37.0 |
| 125 | 42.0 | | 1000 | 35.5 |
| 160 | 41.5 | | 1250 | 33.5 |
| 200 | 41.5 | | 1600 | 31.0 |
| 250 | 41.0 | | 2000 | 28.5 |
| 315 | 40.5 | | 2500 | 26.5 |
| 400 | 39.5 | | 3150 | 23.5 |
| 500 | 38.5 | | 4000 | 21.5 |
| 630 | 37.5 | | 5000 | 19.5 |

Shift the **whole contour** by (target dBA − 45) to retarget. Spec tolerances: ±2 dB per 1/3-oct 100–200 Hz, **±1 dB 200–5000 Hz**, ±1 dBA overall.

**Derived slopes of that contour:**

| Octave span | Slope |
|---|---|
| 100 → 200 Hz | **−1.0 dB/oct** |
| 200 → 400 Hz | −2.0 dB/oct |
| 400 → 800 Hz | −2.5 dB/oct |
| 800 → 1600 Hz | −6.0 dB/oct |
| 1600 → 3150 Hz | **−7.5 dB/oct** |
| 2000 → 4000 Hz | −7.0 dB/oct |

So the common shorthand "pink noise at −5 dB/oct" is an **average**: the real curve is nearly flat below 400 Hz and steepens to ~−7 dB/oct above 1.6 kHz. Independent corroboration of the −5 dB/oct figure: "pink noise filtered to have a spectral slope of −5 dB/octave, presented at around 45 dBA but not exceeding 48 dBA" ([Veitch, Bradley et al.](https://www.researchgate.net/publication/44050651_Masking_Speech_in_Open-Plan_Offices_with_Simulation_Ventilation_Noise_Noise-Level_and_Spectral_Composition_Effects_on_Acoustic_Satisfaction)). ANSI S12.2-2008 **RC curves** use exactly **−5 dB/oct** from 16 Hz–4 kHz as the neutral reference, flagging "(R) rumble" if 16–250 Hz exceeds it by > 5 dB ([RC/NC explainer](https://acousplan.com/learn/noise-criteria-nr-nc-rc-explained)).

**Note: neither brown (−6 dB/oct) nor pink (−3 dB/oct) matches this curve.** The optimum masker is **roughly pink below 500 Hz and roughly brown above 1.6 kHz** — i.e. a pink noise generator plus a high shelf or a gentle lowpass around 1–2 kHz. Dampen's `ambience.tone` parameter should implement exactly this tilt.

#### Why not above 48 dBA

| Level | Finding | Source |
|---|---|---|
| **< 42 dBA** (open plan) | "considered non-performing" | [Chanaud, *Further Thoughts on Sound Masking* (PDF)](https://www.atlasied.com/f/3885/AtlasIED_Sound_Masking_Further_Thoughts.pdf) |
| **45 dBA** | "optimum compromise that maximizes masking… without being too disturbing"; most preferred in the NRC experimental open office | [NRC / Veitch & Bradley](https://www.researchgate.net/publication/44050651_Masking_Speech_in_Open-Plan_Offices_with_Simulation_Ventilation_Noise_Noise-Level_and_Spectral_Composition_Effects_on_Acoustic_Satisfaction) |
| **45 → 48 dBA** | speech privacy improves but **occupant satisfaction decreases** | same |
| **> 48 dBA** | complaints of excessive masking sound increase | [Chanaud](https://www.atlasied.com/f/3885/AtlasIED_Sound_Masking_Further_Thoughts.pdf) |
| Spectral balance | "too much high frequency is unsatisfactory; too much low frequency reduced sound masking **and** decreased satisfaction" | NRC |

Soft dB's shipping defaults: **45 dBA open plan, 42 dBA enclosed rooms.** For Dampen — a single listener on headphones in a quiet room — the enclosed-room figure (**42 dBA**) is the better analogue, and it should be the default ceiling for the ambience bed.

#### SNR thresholds and psychometric slopes

| Quantity | Value | Source |
|---|---|---|
| SII per-band effective SNR range | **[−15 dB, +15 dB]**; band contribution saturates at 0 below −15 and at 1 above +15 ⇒ **1/30 per dB** in the linear region | [PLOS ONE, SII method](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0132409) |
| SRT (50% correct), sentences in speech-shaped noise, normal hearing | **≈ −5 dB SNR** | [PLOS ONE 2020](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0236469) |
| SRT, Plomp-style speech-shaped stationary noise | **−4.1 dB** (male talker), **−3.2 dB** (female) | same |
| Psychometric slope, **sentences** | **~20 %/dB** at threshold | same |
| Psychometric slope, **spondee words** (n = 30) | 9.1 %/dB | [PMC6910021](https://pmc.ncbi.nlm.nih.gov/articles/PMC6910021/) |
| Psychometric slope, **monosyllables** (n = 34) | 6 %/dB | same |
| Range across the literature | **0.4 %/dB to 43.8 %/dB** ⚠ | [Survey of PF slopes](https://www.researchgate.net/publication/262929348_Variations_in_the_Slope_of_the_Psychometric_Functions_for_Speech_Intelligibility) |

**Derived masking targets for Dampen** — this is the operative design rule:

| Objective | Required band SNR (music level − noise level, per critical band) |
|---|---|
| Null a band's contribution to intelligibility entirely | **≤ −15 dB** (noise 15 dB above the music in that band) |
| Halve sentence intelligibility | **≈ −5 dB** |
| Drive sentence intelligibility to the floor | **−10 to −12 dB** (at 20 %/dB, 50% → ~0% takes only ~2.5–3 dB more) |
| Reduce attentional salience without obliterating the music | **−3 to −6 dB in the 2–5 kHz presence band only**, while staying **+10 dB or more** (music above noise) at 100–400 Hz |

**The key insight: masking is per-critical-band; loudness is broadband.** The 2–5 kHz presence region spans **5.43 Bark** and the 5–10 kHz sibilance region **3.89 Bark** (derived from the §3.4 formulas). A bed shaped to sit 6–12 dB above the music across only those ~9 Bark, while sitting well *below* the music at 100–400 Hz, costs far less total loudness — and far less listener fatigue — than broadband masking at the same masking effect. This is the entire argument for a *shaped* bed over "turn up the brown noise".

Fatigue constraint: the NRC data caps the total masker at **42–48 dBA**, and rates high-frequency-heavy spectra worst. So the presence-targeted bed must be level-capped **and** rolled off above ~6 kHz.

#### Privacy metrics (for completeness — and a warning)

| Metric | Definition | Source |
|---|---|---|
| AI (ASTM **E1130**, open plan) | 0 → 1. Uses only the 18 bands **200 Hz – 5 kHz** | [Gover & Bradley, *Canadian Acoustics* 39(3):50–51, 2011 (PDF)](https://jcaa.caa-aca.ca/index.php/jcaa/article/download/2405/2154/0) |
| PI | **PI = (1 − AI) × 100 %** | same |
| SPC (ASTM **E2638**, closed rooms) | **SPC = L_D(avg) + L_b(avg)**, 1/3-oct values arithmetically averaged **160–5000 Hz** | same |

| E2638 category | SPC | ≈ PI | | E1130 category | PI | ≈ SPC |
|---|---|---|---|---|---|---|
| Minimal privacy | 70 | 93 % | | Normal privacy | 80 % | 64 |
| Standard privacy | 75 | 98 % | | Confidential privacy | 95 % | 71 |
| Standard security | 80 | 100 % | | | | |
| High security | 85 | 100 % | | | | |

> **Warning for implementation: PI saturates and is useless as a control variable.** Above SPC 75 / PI 98 %, "the sound insulation or noise can vary by ~12 dB, and yet PI varies by only a few percent"; in that range measured *audibility* ranged 100 % → 0 % while *intelligibility* ranged only ~15 % → 0 %. Use SPC-like dB-linear units or raw band SNR, never PI. (Same source; SPC↔PI correlation R² = 0.94 over 100 simulated cases.)

### 3.4 Critical bands, Bark, ERB, and simultaneous masking thresholds

#### Bark table (Zwicker's 24 critical bands)

| z | Lower | Centre | Upper | BW (Hz) | | z | Lower | Centre | Upper | BW (Hz) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 50 | 100 | 100 | | 13 | 1720 | 1850 | 2000 | 280 |
| 2 | 100 | 150 | 200 | 100 | | 14 | 2000 | 2150 | 2320 | 320 |
| 3 | 200 | 250 | 300 | 100 | | 15 | 2320 | 2500 | 2700 | 380 |
| 4 | 300 | 350 | 400 | 100 | | 16 | 2700 | 2900 | 3150 | 450 |
| 5 | 400 | 450 | 510 | 110 | | 17 | 3150 | 3400 | 3700 | 550 |
| 6 | 510 | 570 | 630 | 120 | | 18 | 3700 | 4000 | 4400 | 700 |
| 7 | 630 | 700 | 770 | 140 | | 19 | 4400 | 4800 | 5300 | 900 |
| 8 | 770 | 840 | 920 | 150 | | 20 | 5300 | 5800 | 6400 | 1100 |
| 9 | 920 | 1000 | 1080 | 160 | | 21 | 6400 | 7000 | 7700 | 1300 |
| 10 | 1080 | 1170 | 1270 | 190 | | 22 | 7700 | 8500 | 9500 | 1800 |
| 11 | 1270 | 1370 | 1480 | 210 | | 23 | 9500 | 10500 | 12000 | 2500 |
| 12 | 1480 | 1600 | 1720 | 240 | | 24 | 12000 | 13500 | 15500 | 3500 |

[Wikipedia, Bark scale](https://en.wikipedia.org/wiki/Bark_scale)

#### Formulas

| Name | Formula | Source |
|---|---|---|
| Zwicker & Terhardt (1980) Bark | **z = 13·arctan(0.00076 f) + 3.5·arctan((f/7500)²)** | [Wikipedia, Bark scale](https://en.wikipedia.org/wiki/Bark_scale) |
| Traunmüller (1990) Bark | z = 26.81 f /(1960 + f) − 0.53 | same |
| Zwicker critical bandwidth | **BW = 25 + 75·(1 + 1.4 f_kHz²)^0.69** Hz | [Siemens, Critical bands](https://community.sw.siemens.com/s/article/critical-bands-in-human-hearing) |
| Glasberg & Moore (1990) **ERB** | **ERB(f) = 24.7·(4.37 f_kHz + 1)** Hz, valid 0.1–10 kHz at moderate levels | [ERB](https://static.hlt.bme.hu/semantics/external/pages/mel/en.wikipedia.org/wiki/Equivalent_rectangular_bandwidth.html) |
| ERB-rate (Cams) | **ERB# = 21.4·log₁₀(0.00437 f_Hz + 1)**; inverse f = (10^(ERB#/21.4) − 1)/0.00437 | [ERB calculator](https://www.cmuse.org/erb-scale-calculator) |

**Comparison at key frequencies (derived):**

| f (Hz) | Bark z | ERB# | ERB width (Hz) | Zwicker CB (Hz) |
|---|---|---|---|---|
| 100 | 0.99 | 3.37 | 35.5 | 100.7 |
| 500 | 4.74 | 10.77 | 78.7 | 117.3 |
| 1000 | 8.51 | 15.62 | 132.6 | 162.2 |
| **2000** | **13.10** | 21.16 | 240.6 | 300.8 |
| 3000 | 15.60 | 24.60 | 348.5 | 479.2 |
| 4000 | 17.26 | 27.11 | 456.5 | 685.4 |
| **5000** | **18.54** | 29.08 | 564.4 | 914.0 |
| 8000 | 21.28 | 33.29 | 888.2 | 1705.7 |
| 16000 | 24.09 | 39.61 | 1751.7 | 4374.2 |

ERB is ≈ half the classical Zwicker CB above 1 kHz. **The two scales are not interchangeable;** ERB is the modern, better-validated one for filter-bank design.

#### Spread of masking — the numbers used in real codecs

| Model | Lower slope (toward **lower** f) | Upper slope (toward **higher** f) | Source |
|---|---|---|---|
| **Terhardt (1979)** — MP3/MPEG lineage | **27 dB/Bark**, level-independent | **−[24 + 0.23·(f_v/kHz)⁻¹ − 0.2·(L_v/dB)] dB/Bark** | [Lynch et al., Eurospeech 1997 (PDF)](https://www.isca-archive.org/eurospeech_1997/lynch97_eurospeech.pdf) |
| **Johnston (1988)** — PE / AAC lineage | **+25 dB/Bark** | **−10 dB/Bark** | same |
| Johnston analytic (Schroeder) | **B(x) = 15.81 + 7.5(x + 0.474) − 17.5·[1 + (x + 0.474)²]^½ dB**, x = separation in Bark, \|j − i\| ≤ 18 | — | same |
| Painter & Spanias | triangular, slopes **+25 / −10 dB/Bark** | — | [Painter & Spanias, *Proc. IEEE* 88(4):457–461, 2000 (PDF)](https://www.cns.nyu.edu/~david/courses/perceptionGrad/Readings/PainterSpanias-ProcIEEE2000.pdf) |

The upper slope is **level-dependent and flattens with level** (the −0.2·L term), so a *loud* masker spreads much further upward. With f in Hz: `−24 − 230/f_Hz + 0.2·L` dB/Bark.

> ⚠ **Sources disagree on magnitude:** 27 vs 25 dB/Bark on the lower side, 10 vs 15 dB/Bark nominal on the upper. Treat **25–27 / 10–15 dB/Bark** as the band.

**MPEG psychoacoustic model 1 masking function**, verbatim (`dz = z(i) − z(j)`, `X` = masker SPL) — [Lynch et al. 1997](https://www.isca-archive.org/eurospeech_1997/lynch97_eurospeech.pdf):

```
v = 17(dz + 1) − (0.4·X[z(j)] + 6)        dB    for −3 ≤ dz <  −1 Bark
v = (0.4·X[z(j)] + 6)·dz                  dB    for −1 ≤ dz <   0 Bark
v = −17·dz                                dB    for  0 ≤ dz <   1 Bark
v = −(dz − 1)·(17 − 0.15·X[z(j)]) − 17    dB    for  1 ≤ dz <   8 Bark
```

#### Signal-to-mask offsets — tonal vs noise maskers

| Scenario | Offset below masker | Source |
|---|---|---|
| **Tone masking noise (TMN)** | **−(14.5 + i) dB**, i = Bark index | [Lynch 1997](https://www.isca-archive.org/eurospeech_1997/lynch97_eurospeech.pdf), [Painter & Spanias](https://www.cns.nyu.edu/~david/courses/perceptionGrad/Readings/PainterSpanias-ProcIEEE2000.pdf) |
| **Noise masking tone (NMT)** | **−5.5 dB** (uniform) | same |
| Tonality-blended (Johnston) | **O_i = α(14.5 + i) + (1 − α)·5.5 dB**, α from spectral flatness SFM = 10·log₁₀(GM/AM) | [Lynch 1997](https://www.isca-archive.org/eurospeech_1997/lynch97_eurospeech.pdf) |
| Measured TMN SMR at threshold, 1 kHz, 80 dB masker, 1-Bark probe | 24 dB | [Painter & Spanias](https://www.cns.nyu.edu/~david/courses/perceptionGrad/Readings/PainterSpanias-ProcIEEE2000.pdf) |
| Measured NMN threshold SMR, wideband | ≈ 26 dB | same |
| Overshoot (probe onset just after masker onset) can boost masking by | **21–28 dB** | same |

**This is the quantitative justification for Dampen's whole noise-bed thesis:** noise maskers are **9–19 dB more effective per dB** than tonal maskers (5.5 dB offset vs 14.5 + z). A broadband noise bed buys far more masking per unit of added loudness than any tonal or musical layer could.

#### Temporal masking

> ⚠ **Sources disagree substantially.**

| Quantity | Painter & Spanias | ScienceDirect survey |
|---|---|---|
| **Pre-masking (backward)** | "significant premasking tends to last only about **1–2 ms**" | "can last up to **20 ms**, significant only 1–5 ms before onset"; "occurs 5–20 ms before" |
| **Post-masking (forward)** | "**50 to 300 ms**, depending on strength and duration of the masker" | "effective for at least 20 ms… up to about 200 ms"; "**50–200 ms** after masker is turned off" |

([Painter & Spanias](https://www.cns.nyu.edu/~david/courses/perceptionGrad/Readings/PainterSpanias-ProcIEEE2000.pdf); [ScienceDirect, Masking effect](https://www.sciencedirect.com/topics/computer-science/masking-effect))

Safe working numbers: **pre-masking 2–20 ms (effective ~1–5 ms), post-masking 50–200 ms.** The asymmetry is large, which is why post-masking dominates codec design.

**Implication for Dampen:** a *continuous* noise bed gains nothing from temporal masking beyond ~200 ms, so **transient suppression must come from simultaneous (spectral) masking and from the compressor (§2.11), not from the noise bed.** Do not expect a noise floor to hide a snare hit.

### 3.5 Speech-matched noise — the spectrum to actually use

**To mask speech, match speech.** The universal long-term average speech spectrum (LTASS), from [Byrne, Dillon, Tran et al., *JASA* 96(4):2108–2120, 1994 (PDF)](https://harlmemphis.org/wp-content/uploads/2020/06/international-.pdf) — 18 samples, 12 languages, 15 localities, mic at 45° / 20 cm. Table II, normalised to **70 dB SPL overall** (subtract 5 dB for a 65 dB reference):

| f (Hz) | Male | Female | **Combined** | | f (Hz) | Male | Female | **Combined** |
|---|---|---|---|---|---|---|---|---|
| 63 | 38.6 | 37.0 | **38.6** | | 1000 | 53.1 | 54.3 | **53.7** |
| 80 | 43.5 | 36.0 | **43.5** | | 1250 | 53.7 | 52.3 | **53.0** |
| 100 | 54.4 | 37.5 | **54.4** | | 1600 | 52.3 | 51.7 | **52.0** |
| 125 | 57.7 | 40.1 | **57.7** | | 2000 | 48.7 | 48.8 | **48.7** |
| 160 | 56.8 | 53.4 | **56.8** | | 2500 | 48.9 | 47.3 | **48.1** |
| 200 | 58.2 | 62.2 | **60.2** | | 3150 | 47.0 | 46.7 | **46.8** |
| 250 | 59.7 | 60.9 | **60.3** | | 4000 | 46.0 | 45.3 | **45.6** |
| 315 | 60.0 | 58.1 | **59.0** | | 5000 | 44.4 | 44.6 | **44.5** |
| 400 | 62.4 | 61.7 | **62.1** | | 6300 | 43.3 | 45.2 | **44.3** |
| 500 | 62.6 | 61.7 | **62.1** | | 8000 | 42.4 | 44.9 | **43.7** |
| 630 | 60.6 | 60.4 | **60.5** | | 10000 | 41.9 | 45.0 | **43.4** |
| 800 | 55.7 | 58.0 | **56.8** | | 12500 | 39.8 | 42.8 | **41.3** |
| | | | | | 16000 | 40.4 | 41.1 | **40.7** |

Combined = male below 160 Hz (F0 difference), average above. Other findings from the paper: **max short-term RMS is 10 dB above max long-term RMS** per 1/3-octave band, consistent across languages and frequency; the L1−Leq difference is **10 dB**; 45° vs 0° incidence costs about **−2 dB from 1–5 kHz**.

**Derived LTASS slopes:** 500→1000 Hz **−8.4 dB/oct**; 1→2 kHz **−5.0**; 2→4 kHz **−3.1**; 4→8 kHz **−1.9**; overall 500 Hz→4 kHz **−5.5 dB/oct**.

> **The important convergence:** the LTASS average slope (−5.5 dB/oct) is essentially identical to the NRC optimum masking slope (−5 dB/oct). **The optimal office masking spectrum is an LTASS-shaped noise.** That is the correct prior for Dampen's bed: shape the noise like speech, because what you are masking (sung lyrics) is speech.

#### ICRA noise — the speech-shaped-noise standard

[Dreschler, Verschuure, Ludvigsen & Westermann, *Audiology* 40(3):148–157, 2001 (PDF)](https://icra-audiology.org/wp-content/uploads/ICRA_Files/noises/ICRA-paper-Audiology.pdf)

| Parameter | Value |
|---|---|
| Spectral filter shape (per ANSI S3.5) | **+12 dB/oct below 100 Hz (male) / 200 Hz (female), flat 100/200–500 Hz, −9 dB/oct above 500 Hz** |
| Band-split for modulation preservation | **3 bands**; mid band **800–2400 Hz** (second-formant region); flanks > 100 dB/oct, out-of-band damping > 50 dB |
| Randomisation | Schroeder sign-flip at p = 0.5 (preserves envelope, whitens spectrum), then 512-pt FFT phase randomisation with 7/8 overlap-add |
| Channel decorrelation | two channels practically uncorrelated (one is a 30-s delayed replica) |
| Tracks 1–3 | unmodulated male, **normal / raised / loud** effort |
| Tracks 7–9 | multi-talker babble; distant talkers at **−6 dB** to simulate distance |

ANSI S3.5-1997 standard vocal-effort overall levels: **62.4 / 68.3 / 74.9 / 82.3 dB SPL** for normal / raised / loud / shouted ([ANSI preview PDF](https://webstore.ansi.org/preview-pages/ASA/preview_ANSI+ASA+S3.5-1997+(R2020).pdf)).

The **−9 dB/oct above 500 Hz** figure is steeper than both the NRC masker and the LTASS. Reconciliation: ICRA is a *test* noise matched to a single talker's spectrum, not an *optimum masker*. For Dampen, use the LTASS/NRC shape, not ICRA's.

### 3.6 Natural noise spectra — and an honest admission

> ⚠ **This is the weakest-sourced part of this entire document.** There is no publicly available, clean 1/3-octave dataset for airborne rain, stream, fire or fan noise that I could obtain. Published figures are scattered, and several commonly cited "rain spectrum" numbers are **hydrophone measurements**, not airborne.

| Source | Measured characteristic | Citation | Quality |
|---|---|---|---|
| **Rain** (general) | spectral slope **−16 to −20 dB/decade (≈ −4.8 to −6.0 dB/oct)** | [JASA 149(6):4579](https://pubs.aip.org/asa/jasa/article/149/6/4579/1059394/Characterizing-underwater-noise-during-rain-at-the) | ⚠ **underwater** study; airborne transfer unverified |
| **Rain on roofs** | median SPL per 1/3-oct rises with rainfall rate **mainly above ~500 Hz – 1 kHz** | [BRE IP2/06 (PDF)](https://files.bregroup.com/bre-co-uk-file-library-copy/filelibrary/rpts/IP02_06_Rain_noise.pdf); [Noise from simulated rainfall on profiled steel roofs](https://www.sciencedirect.com/science/article/abs/pii/0003682X94901120) | Real, but impact noise on a specific structure |
| **Light rain, bubble mechanism** | broad spectral peak **12–25 kHz** from entrained microbubble oscillation; slope flattens as rain rate rises | [JASA 149(6):4579](https://pubs.aip.org/asa/jasa/article/149/6/4579/1059394/Characterizing-underwater-noise-during-rain-at-the) | Underwater |
| **Waterfalls** | field measurements, flow 0.2–20,000 cfs, drop 1–270 ft; octave-band spectra published | [*Waterfall noise*](https://www.researchgate.net/publication/243528166_Waterfall_noise) | Primary but paywalled |
| **Water features** (streams / falling water) | **L_Aeq,1m = 72–82 dB** | [Evaluating water sounds to improve urban soundscape (PDF)](https://core.ac.uk/download/pdf/80775919.pdf) | Primary, range only |
| **Rivers** | **30–60 dB** SPL along a river course, higher at constrictions | [Earth Surf. Process. Landforms](https://onlinelibrary.wiley.com/doi/full/10.1002/esp.5199) | Primary |
| **Stream / river temporal structure** | spectral density slope ≈ **−0.5** in psychoacoustic-parameter *time series* | [1/f noise in psychoacoustic parameters](https://www.researchgate.net/publication/281518412_Presence_of_1f_noise_in_the_temporal_structure_of_psychoacoustic_parameters_of_natural_and_urban_sounds) | ⚠ This is *temporal* 1/f, **not** the audio spectrum — do not conflate |
| **Ocean surf** | breaking waves radiate **30–500 Hz**; SPL **60 dB at 0.4 m wave height → 78 dB at 2.0 m** | [Surf noise & ambient noise](https://www.researchgate.net/publication/263284688_Influence_of_surf_noise_on_oceanic_ambient_noise_in_coastal_waters_with_sandy_seabed); [Air-borne sound from sea waves](https://pubmed.ncbi.nlm.nih.gov/21117726/) | Mixed air/underwater |
| **HVAC / air conditioner / centrifugal fans** | highest energy in the **63, 125, 250 Hz** octave bands; "many HVAC noise problems manifest below 63 Hz"; RC reference −5 dB/oct 16 Hz–4 kHz; LF excess > 5 dB ⇒ "(R) rumble" | [Daikin AG 31-010, HVAC Acoustic Fundamentals (PDF)](https://tahoeweb.daikinapplied.com/api/general/DownloadDocumentByName/media/AG31-010_HVAC_Acoustic_Fundamentals.pdf); [HVAC Systems Noise Control (PDF)](https://www.cedengineering.com/userfiles/HVAC%20Systems%20Noise%20Control.pdf) | **Good** |
| **Café / restaurant babble** | Chinese restaurants **67.6–79.3 dBA**; fast food 69.1–79.1; Western 66.7–82.6; coffee chains avg **69–72 dBA** (Starbucks 72, Dunkin' 69, Peet's 71; n > 1400 check-ins); "ideal for working/conversing" ≈ **66 dBA**, "difficult" ≈ **74 dBA** | [Food courts & coffee houses (PDF)](http://www.tfzr.uns.ac.rs/iizs/files/14.pdf); [Noise in restaurants: levels and model](https://www.researchgate.net/publication/268243750_Noise_in_restaurants_Levels_and_mathematical_model); [Fresh Cup](https://freshcup.com/the-difference-between-a-buzzing-cafe-and-a-noisy-one-is-smaller-than-you-think/) | dBA only, **no spectra** |
| **Wind** | slope **−16 to −20 dB/decade**; "relatively random variations" temporally | [MDPI JMSE 14(7):649](https://www.mdpi.com/2077-1312/14/7/649) | ⚠ underwater |
| **Fireplace** | **no measurement data found** | — | ⚠ none |

**Practical recommendation.** The qualitative ordering you expect is directionally right — rain HF-weighted, river mid-weighted, fan/AC LF-dominated — and the **HVAC data is genuinely good**. But do **not** ship "rain has a −4 dB/oct slope" as a fact. Synthesise Dampen's beds from the NRC/LTASS target curve with per-kind deviations, and if you need accuracy, **measure your own**: a 1/3-octave analysis over ESC-50 / UrbanSound8K recordings will give you better numbers than anything published.

Suggested synthesis targets for the `AmbienceKind` values, expressed as deviations from the NRC optimum masking contour (§3.3) — these are **design targets, not measurements**:

| `kind` | Base | Deviation from NRC contour | Notes |
|---|---|---|---|
| `brown` | 1/f² | −6 dB/oct throughout | LF-heavy; least fatiguing, weakest presence-band masking |
| `pink` | 1/f | −3 dB/oct throughout | Closest single-slope approximation below 500 Hz |
| `white` | flat | 0 dB/oct | **Too bright; highest fatigue.** Only usable heavily shelved |
| `rain` | pink | **+4 dB above 2 kHz**, +6 dB above 6 kHz, 15–40 Hz amplitude jitter | Best presence-band masker per §3.3; cap level tightly |
| `river` | pink | **+3 dB 400 Hz–2 kHz**, −4 dB above 8 kHz | Mid-weighted; good compromise |
| `fan` | brown | **+5 dB at 63–250 Hz**, −6 dB above 2 kHz | LF-dominant per the HVAC data; poor masker, very low fatigue |
| `cafe` | LTASS-shaped | match the §3.5 Combined column | ⚠ **Contains speech-like modulation → risks *causing* the irrelevant-sound effect (§1).** Make it clearly non-semantic (reversed/spectrally scrambled babble) or omit |
| `vinyl` | pink + impulses | highpass the crackle above 2 kHz | Per §2.12: periodic pop at 0.556 Hz, Poisson crackle 8–25 events/s |
| `tape` | pink | −3 dB above 10 kHz, cap at 15 kHz (Type I response) | Hiss at −50 dB relative to programme per §2.12 |

### 3.7 Binaural beats and isochronic tones — what the evidence does and does not support

#### The psychoacoustic constraints are solid

| Constraint | Value | Source |
|---|---|---|
| Carrier must be ≤ | **1000 Hz** — the auditory pathway only phase-locks up to ~1 kHz | Licklider, Webster & Hedlun 1950, via [Ingendoh, Posny & Heine 2023, *PLoS ONE* 18(5):e0286023](https://journals.plos.org/plosone/article/file?id=10.1371%2Fjournal.pone.0286023&type=printable) |
| Best carrier region | **≈ 400 Hz** (widest usable beat range); 500 Hz also cited | same; [On the Frequency Limits of Binaural Beats](https://www.semanticscholar.org/paper/On-the-Frequency-Limits-of-Binaural-Beats-Licklider-Webster/8398ecc34c2bba8301f2df176cf15df6cf90d8ed) |
| Max beat Δf | **≈ 30 Hz** (Perrott & Nelson 1969); Licklider found ≈ 35 Hz near 400 Hz. Beyond this the two tones are heard separately. | [Ingendoh 2023](https://journals.plos.org/plosone/article/file?id=10.1371%2Fjournal.pone.0286023&type=printable) |
| Percept vs Δf | **< 3 Hz**: rotating tone. **up to 20 Hz**: loudness fluctuation. **> 20–25 Hz**: rough sound. | same |

#### What IS supported

[Garcia-Argibay, Santed & Reales 2019, *Psychological Research* 83:357–372](https://link.springer.com/article/10.1007/s00426-018-1066-8): 22 studies, **35 effect sizes**, overall **g = 0.45** ("medium, significant, consistent"). Direction and magnitude depend on beat frequency, time under exposure, and whether exposure is before or during the task. Meta-regression finding worth noting: **masking binaural beats with white or pink noise is not necessary** — unmasked beats gave similar effects.

Anxiety reduction (including perioperative) is the most consistently replicated domain ([Binaural Beats for Perioperative Anxiety and Pain: SR & MA](https://www.researchgate.net/publication/397092873_Binaural_Beats_for_Perioperative_Anxiety_and_Pain_A_Systematic_Review_and_Meta-Analysis)). A 2022 meta-analysis on memory and attention concluded "potential for improving these domains, but existing results are inconsistent" ([link](https://www.researchgate.net/publication/362054258_Potential_of_binaural_beats_intervention_for_improving_memory_and_attention_insights_from_meta-analysis_and_systematic_review)).

#### What is NOT supported

**Brainwave entrainment — the mechanism everyone cites — fails.** [Ingendoh, Posny & Heine 2023, *PLoS ONE* 18(5):e0286023](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10198548/) reviewed **14 EEG studies: 5 supporting entrainment, 8 contradictory, 1 mixed.** Their conclusion: "the research question cannot be settled at this point." Specific negatives:

| Study | Stimulation | Control | Result |
|---|---|---|---|
| Goodin et al. | 7 Hz (theta), 16 Hz (beta) BB | white noise | **no difference** in average spectral power |
| Gao et al. | 5 min delta/theta/alpha/beta BB | pink noise | **no change** in relative power |
| López-Caballero & Escera | BB | — | **no effect** on spectral power in any major band |
| [Frontiers in Human Neuroscience](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2017.00557/full) | BB | — | "no effects of binaural-beat stimulation on EEG spectral power"; "do not support binaural beats as a potential brainwave entrainment tool" |

**Five caveats to state plainly about the g = 0.45 figure:**

1. It pools heterogeneous outcome domains (cognition, anxiety, pain). A single number across those is near-meaningless for "will this help me focus?"
2. "Very heterogeneous regarding the implementation of the binaural beats, the experimental designs, and the EEG parameters and analyses" (Ingendoh 2023). The applied and mechanistic literatures point in opposite directions.
3. **Blinding is essentially impossible** — participants hear the beat. Expectancy effects are unaddressed in most studies.
4. The applied studies' stated theoretical basis (entrainment) is exactly the thing that does not replicate. Ingendoh's framing: the mechanistic failures make "the results of those applied research endeavors highly questionable."
5. **Isochronic tones specifically: no meta-analysis exists.** Claims of superiority over binaural beats are marketing, not evidence.

**Recommendation for Dampen: do not ship binaural beats as a focus feature, and do not claim entrainment or cognitive benefit.** If you ship them at all as optional ambience, cap Δf ≤ 30 Hz with carriers 300–500 Hz so the percept actually exists, and label them as mood/ambience, not performance. There is also a direct conflict with this product's core thesis: a 1–30 Hz beat is a **changing-state, amplitude-modulated** signal, and §1 says changing-state sound is exactly what disrupts serial recall. Binaural beats are, on the best available theory of distraction, *counterproductive* for a focus product.

---

## 4. Loudness & safety

### 4.1 LUFS, EBU R128, and the target for background listening

#### The measurement algorithm (ITU-R BS.1770-5)

Four stages: **K-weighting → per-channel mean square → channel-weighted sum (LFE excluded) → gating** of 400 ms blocks at 75 % overlap, with two thresholds. ([Rec. ITU-R BS.1770-5 (11/2023), PDF](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf))

```
z_i = (1/T)·∫₀ᵀ y_i² dt                           per-channel mean square, K-weighted
L_K = −0.691 + 10·log₁₀ Σ_i G_i·z_i      LKFS

G_L = G_R = G_C = 1.0        (0 dB)
G_Ls = G_Rs  = 1.41          (≈ +1.5 dB)
LFE                          excluded

T_g = 400 ms, overlap 75 %  (hop 100 ms)
l_j = −0.691 + 10·log₁₀ Σ_i G_i·z_ij
Γ_a = −70 LKFS                            absolute gate
Γ_r = (Γ_a-gated loudness) − 10 LKFS      relative gate
J_g = { j : l_j > Γ_r  and  l_j > Γ_a }
```

The constant **−0.691 cancels the K-weighting gain at 997 Hz** (IEC 61606's actual reference frequency, nominally "1 kHz"). Calibration test: a 0 dBFS 997 Hz sine into L, C or R must read **−3.01 LKFS**.

The K-weighting filter is two biquads — a stage-1 high shelf ("spherical head" model, ≈ **+4 dB above ~1681 Hz**) and a stage-2 RLB high-pass (≈ **38 Hz**). The published coefficients are **48 kHz only**; see §5.8 for the exact values and a verified parametric reconstruction for other rates.

Momentary = 400 ms window; short-term = 3 s; integrated = gated as above. **LRA** = difference between the **10th and 95th percentiles** of short-term loudness, in LU — and R 128 deliberately **prescribes no maximum LRA** ([EBU Tech 3342, PDF](https://tech.ebu.ch/docs/tech/tech3342.pdf)).

#### Targets

| Spec / platform | Integrated target | Tolerance | True peak | Source |
|---|---|---|---|---|
| **EBU R 128** | **−23.0 LUFS** | **±0.5 LU** (±1.0 LU live) | **−1 dBTP** | [EBU R 128](https://en.wikipedia.org/wiki/EBU_R_128); [EBU Tech 3341, PDF](https://tech.ebu.ch/docs/tech/tech3341v2_0.pdf) |
| **ATSC A/85** (US, CALM Act) | **−24 LKFS** (Anchor Element) | **±2 LU** | **−2.0 dBTP ±0.5 dB** | [ATSC A/85, PDF](https://www.atsc.org/wp-content/uploads/2026/07/A85-2026-07.pdf) |
| Spotify | −14 LUFS (boosts quiet masters *up*) | — | −1 dBTP (−2 if master > −14) | [DSP targets compared](https://www.velveteen.fm/guides/mastering-for-streaming/dsp-loudness-targets-compared) |
| Apple Music (Sound Check) | −16 LUFS (boosts up) | — | −1 dBTP | same |
| YouTube (video) | −14 LUFS, **turns down only** | — | −1 dBTP | same |
| Tidal | −14 LUFS, album-normalised, turns down only | — | −1 dBTP | same |
| Amazon Music | −14 LUFS, turns down only | — | −1 dBTP | same |
| ⚠ YouTube Music | ≈ −7 LUFS (independent testing) | — | — | same — **contested** |

> ⚠ **Only EBU R 128 and ATSC A/85 are standards.** Every streaming figure above comes from third-party reverse-engineering, not a published spec, and they change without notice. Do not hard-code them.

#### Background / ambient listening levels

There is **no AES or broadcast standard for "ambient listening LUFS."** What exists:

| Context | Level | Source |
|---|---|---|
| Retail background music | **50–60 dBA** (brand-dependent) | [CLRN](https://www.clrn.org/how-loud-should-background-music-be/) |
| Normal conversation comfort | 55–65 dB | [Food courts & coffee houses, PDF](http://www.tfzr.uns.ac.rs/iizs/files/14.pdf) |
| **Office masking noise, optimum** | **45 dBA**, never above 48 | §3.3, NRC |
| Office masking, enclosed rooms | **42 dBA** | §3.3, Soft dB |
| Music under voiceover | music **−18 to −25 dB** below dialogue; typical dialogue −18 to −9 dBFS, music **−30 to −35 dBFS** | [Tem.Polor](https://www.tempolor.com/blog/audio-levels/); [Overseeros](https://www.overseeros.com/blog/background-music-volume-under-voiceover) |
| **Working-memory impairment threshold** | **≥ 60 dBA impaired auditory WM; no effect at 40 or 50 dBA** | [*Building & Environment* 2024](https://www.sciencedirect.com/science/article/abs/pii/S0360132324011557) |
| WHO 1999 community noise, bedrooms | ~30 dBA average, 45 dBA max events | [soundsmeter](https://soundsmeter.com/guides/noise-level-for-sleep) |

#### LUFS ↔ dBA SPL: the honest answer

**There is no fixed mapping.** LUFS is relative to digital full scale; SPL depends on the playback gain chain, which a web app cannot see. The only usable anchor is the **K-System / cinema calibration: pink noise at −20 dBFS produces 83 dB SPL (C-weighted) per speaker**, i.e. 0 dBFS ≈ 103 dB SPL at reference gain ([Sound on Sound](https://www.soundonsound.com/techniques/establishing-project-studio-reference-monitoring-levels?page=3); [Mastering the Mix](https://www.masteringthemix.com/blogs/learn/the-perfect-monitoring-levels-for-your-home-studio)).

**Dampen's target, derived:**

| Decision | Value | Reasoning |
|---|---|---|
| **Target acoustic level at the listener** | **45–55 dBA** | Office-masking optimum (45) through retail-BGM range (55); safely below the 60 dBA working-memory impairment threshold; far below Salamé & Baddeley's 75 dB(A) experimental level |
| At the K-System anchor | 45 dBA ≈ −58 dBFS-equivalent; 55 dBA ≈ −48 dBFS-equivalent at reference gain | i.e. 28–38 dB below cinema reference |
| **Integrated LUFS target for the processed stream** | **−20 to −23 LUFS** | Normalise the *processed* output to a conventional broadcast target, then let device volume land it at 45–55 dBA. Choosing −23 LUFS (R 128) rather than −14 (streaming) gives 9 dB more headroom for the reverb tail and noise bed, and removes the temptation to compensate for lowpass losses with gain. |
| **True peak ceiling** | **−1.5 dBTP** | §5.9: there is no built-in limiter; leave margin for the soft-clip stage |
| **LRA target** | **3–6 LU** | R 128 sets no limit, so this is Dampen's own parameter. A wide loudness range defeats "background": loud passages re-capture attention (§1.2). This is the quantitative spec for the compressor in §2.11. |

> **Do not ship a claim like "background = −35 LUFS".** The LUFS number does not determine loudness at the ear; the device volume does. Normalise to −20…−23 LUFS, expose a volume control, and if you want to be rigorous, offer a one-time calibration step using a phone SPL meter.

### 4.2 Equal-loudness contours (ISO 226) — the EQ compensation that keeps music recognisable

#### Formula and parameters

ISO 226:2003 §4 — for a loudness level L_N in phon:

```
A_f = 4.47e-3 · (10^(0.025·L_N) − 1.15) + [0.4 · 10^((T_f + L_U)/10 − 9)]^α_f
L_p = (10/α_f) · log₁₀(A_f) − L_U + 94      dB SPL
```

Valid at all frequencies for **20 ≤ phon < 80** (and at 1 kHz only up to 90). Parameter tables (29 frequencies, 20 Hz–12.5 kHz), from the [IoSR-Surrey MATLAB implementation of ISO 226:2003](https://github.com/IoSR-Surrey/MatlabToolbox/blob/master/+iosr/+auditory/iso226.m):

| f (Hz) | α_f | L_U | T_f | | f (Hz) | α_f | L_U | T_f |
|---|---|---|---|---|---|---|---|---|
| 20 | 0.532 | −31.6 | 78.5 | | 800 | 0.253 | 0.5 | 2.2 |
| 25 | 0.506 | −27.2 | 68.7 | | 1000 | 0.250 | 0.0 | 2.4 |
| 31.5 | 0.480 | −23.0 | 59.5 | | 1250 | 0.246 | −2.7 | 3.5 |
| 40 | 0.455 | −19.1 | 51.1 | | 1600 | 0.244 | −4.1 | 1.7 |
| 50 | 0.432 | −15.9 | 44.0 | | 2000 | 0.243 | −1.0 | −1.3 |
| 63 | 0.409 | −13.0 | 37.5 | | 2500 | 0.243 | 1.7 | −4.2 |
| 80 | 0.387 | −10.3 | 31.5 | | 3150 | 0.243 | 2.5 | −6.0 |
| 100 | 0.367 | −8.1 | 26.5 | | 4000 | 0.242 | 1.2 | −5.4 |
| 125 | 0.349 | −6.2 | 22.1 | | 5000 | 0.242 | −2.1 | −1.5 |
| 160 | 0.330 | −4.5 | 17.9 | | 6300 | 0.245 | −7.1 | 6.0 |
| 200 | 0.315 | −3.1 | 14.4 | | 8000 | 0.254 | −11.2 | 12.6 |
| 250 | 0.301 | −2.0 | 11.4 | | 10000 | 0.271 | −10.7 | 13.9 |
| 315 | 0.288 | −1.1 | 8.6 | | 12500 | 0.301 | −3.1 | 12.3 |
| 400 | 0.276 | −0.4 | 6.2 | | | | | |
| 500 | 0.267 | 0.0 | 4.4 | | | | | |
| 630 | 0.259 | 0.3 | 3.0 | | | | | |

**ISO 226:2023 vs :2003 — implement 2003.** [Suzuki, Takeshima & Kurakata, *Acoust. Sci. & Tech.* 45(1), 2024 (PDF)](https://www.jstage.jst.go.jp/article/ast/45/1/45_e23.66/_pdf/-char/en), by the revision's project leader: *"The differences from the 2003 edition are only 0.6 dB at most, and the 2023 standard can be regarded as the same as the 2003 edition in terms of practical use."* The revision adopted the JASA 2004 loudness exponent (r = 0.30 vs 0.25) and ISO 389-7:2019's 0.4 dB lower 20 Hz threshold. **No design decision changes.**

(Historical note worth keeping in mind when reading older material: pre-2003 ISO 226, based on Robinson–Dadson, was **> 10 dB wrong below 1 kHz**. Fletcher–Munson turned out closer to the truth, with inter-study spread of 10–15 dB in the LF region — [Wikipedia](https://en.wikipedia.org/wiki/Equal-loudness_contour).)

#### Computed contours — SPL (dB) at each phon level

| f (Hz) | 20 ph | 30 ph | 40 ph | 50 ph | 60 ph | 70 ph | 80 ph | 90 ph |
|---|---|---|---|---|---|---|---|---|
| 20 | 89.6 | 94.8 | 99.9 | 104.7 | 109.5 | 114.3 | 119.0 | 123.7 |
| 31.5 | 76.0 | 82.4 | 88.2 | 93.7 | 99.1 | 104.4 | 109.6 | 114.9 |
| **50** | 64.0 | 71.3 | **77.8** | 84.0 | 90.0 | 95.9 | **101.7** | 107.5 |
| 63 | 58.6 | 66.2 | 73.1 | 79.6 | 85.9 | 92.2 | 98.4 | 104.5 |
| 80 | 53.2 | 61.2 | 68.5 | 75.4 | 82.1 | 88.6 | 95.2 | 101.7 |
| **100** | 48.4 | 56.8 | **64.4** | 71.6 | 78.7 | 85.6 | **92.5** | 99.3 |
| 125 | 43.9 | 52.6 | 60.6 | 68.2 | 75.6 | 82.9 | 90.1 | 97.3 |
| 200 | 35.5 | 44.8 | 53.4 | 61.7 | 69.9 | 77.9 | 85.9 | 93.9 |
| 500 | 23.4 | 33.4 | 43.1 | 52.6 | 62.1 | 71.5 | 80.9 | 90.2 |
| **1000** | 20.0 | 30.0 | **40.0** | 50.0 | 60.0 | 70.0 | **80.0** | 90.0 |
| 2000 | 18.2 | 28.8 | 39.2 | 49.6 | 60.0 | 70.3 | 80.6 | 90.9 |
| 3150 | 14.3 | 25.0 | 35.6 | 46.1 | 56.4 | 66.8 | 77.1 | 87.4 |
| 4000 | 15.1 | 26.0 | 36.6 | 47.1 | 57.6 | 68.0 | 78.3 | 88.7 |
| 6300 | 25.0 | 35.5 | 45.8 | 56.1 | 66.4 | 76.6 | 86.8 | 97.0 |
| 8000 | 31.5 | 41.7 | 51.8 | 61.8 | 71.7 | 81.5 | 91.4 | 101.3 |
| **10000** | 34.4 | 44.6 | **54.3** | 63.8 | 73.2 | 82.5 | **91.7** | 101.0 |
| 12500 | 33.0 | 42.5 | 51.5 | 60.1 | 68.6 | 77.0 | 85.4 | 93.7 |

#### 40 phon vs 80 phon: how much sensitivity you lose by playing quietly

Excess SPL required *relative to 1 kHz* on the same contour:

| f | at 40 phon | at 80 phon | **Sensitivity gained by playing loud** |
|---|---|---|---|
| **50 Hz** | +37.8 dB | +21.7 dB | **16.1 dB** |
| **100 Hz** | +24.4 dB | +12.5 dB | **11.9 dB** |
| 200 Hz | +13.4 dB | +5.9 dB | 7.5 dB |
| 500 Hz | +3.0 dB | +0.9 dB | 2.1 dB |
| 3150 Hz | −4.4 dB | −2.9 dB | −1.5 dB |
| **10 kHz** | +14.3 dB | +11.7 dB | **2.6 dB** |

> **This answers the brief's question directly.** Dropping from 80 to 40 phon costs **16 dB of effective sensitivity at 50 Hz** and **12 dB at 100 Hz**, but only **2.6 dB at 10 kHz**. **The low-frequency collapse dominates by roughly 5:1.** So when Dampen lowpasses *and* lowers the volume, the thing that disappears perceptually is the **bass**, not the treble — and the fix is almost entirely a **low shelf**, not a "smile" curve. The classic hi-fi loudness button, which boosts both ends roughly equally, is wrong by about a factor of six on the treble side.

#### Loudness-compensation EQ — boost to apply when turning down from an 80-phon reference

| f (Hz) | −10 dB (→ 70 ph) | −20 dB (→ 60 ph) | −30 dB (→ 50 ph) |
|---|---|---|---|
| 20 | +5.27 | +10.52 | +15.73 |
| 31.5 | +4.74 | +9.43 | +14.05 |
| **50** | **+4.15** | **+8.24** | **+12.24** |
| 63 | +3.82 | +7.58 | +11.25 |
| 80 | +3.47 | +6.88 | +10.19 |
| **100** | **+3.12** | **+6.18** | **+9.13** |
| 125 | +2.77 | +5.47 | +8.08 |
| 160 | +2.36 | +4.66 | +6.86 |
| **200** | **+2.00** | **+3.95** | **+5.81** |
| 250 | +1.64 | +3.23 | +4.74 |
| 315 | +1.27 | +2.50 | +3.66 |
| **500** | **+0.61** | **+1.19** | **+1.73** |
| 800 | +0.11 | +0.22 | +0.31 |
| **1000** | **0.00** | **0.00** | **0.00** |
| 2000 | −0.31 | −0.62 | −0.97 |
| 4000 | −0.36 | −0.74 | −1.17 |
| 6300 | −0.22 | −0.45 | −0.70 |
| 8000 | +0.14 | +0.26 | +0.35 |
| **10000** | **+0.73** | **+1.42** | **+2.04** |
| 12500 | +1.64 | +3.22 | +4.73 |

**The implementable design rule:**

```
lowShelf.freq ≈ 300–400 Hz      (where the curve crosses ~+1 dB of its asymptote)
lowShelf.gain ≈ +4 dB per 10 dB of attenuation, measured at 50 Hz
              ≈ +4 / +8 / +12 dB for −10 / −20 / −30 dB of level drop
              asymptoting to +5 / +10 / +16 dB at 20 Hz

optional high shelf above ~8 kHz: +0.7 / +1.4 / +2.0 dB at 10 kHz
  — roughly 1/6 the size of the LF correction, and irrelevant once you lowpass
optional tiny dip at 2–6 kHz: −0.3 to −1.2 dB (you are already cutting far more)
```

**Dampen's `lowShelf` parameter is exactly this compensator.** Its gain should scale with `outputGain` (and with how much the lowpass has removed), not be a fixed preset constant — a preset at −8 dB output needs roughly +3 dB at 50 Hz, one at −20 dB needs +8 dB. The preset tables in §8 are specified at their stated `outputGain`; if you expose a master volume below that, scale `lowShelf.gain` up by ≈ 0.4 dB per additional dB of attenuation, capping at about +12 dB to avoid woofer abuse.

Real-world implementations for reference: the hi-fi "loudness" switch; **THX** then **Audyssey Dynamic EQ** (which "continued research completed by THX on loudness compensation and did detailed analysis to come up with updated Fletcher-Munson equal loudness curves", referenced to the **85 dB** film mixing level via a Reference Level Offset); **Dolby Volume** ("analyzes the source in up to 40 frequency bands and performs independent loudness adjustments"). ([Loudness compensation](https://en.wikipedia.org/wiki/Loudness_compensation); [Audyssey Dynamic EQ](https://simplehomecinema.com/2021/08/11/audyssey-dynamic-eq-and-dynamic-volume-are-your-friends/); [Sound & Vision](https://www.soundandvision.com/content/tune-turn-down-turn-page-2))

### 4.3 Hearing safety — dose maths for a multi-hour product

Dampen is designed to run for entire working days. That makes it a hearing-safety product whether or not it wants to be.

#### Standards

| Standard | Reference exposure | Exchange rate | Source |
|---|---|---|---|
| **WHO–ITU-T H.870** Mode 1 (adults) | **80 dBA for 40 h/week** = 1.6 Pa²h | **3 dB** | [ITU-T H.870 (V2) 03/2022](https://www.itu.int/epublications/publication/itu-t-h-870-v2-2022-03-guidelines-for-safe-listening-devices-systems); [WHO-ITU summary, PDF](https://cdn.who.int/media/docs/default-source/documents/health-topics/deafness-and-hearing-loss/standard-summary-make-listening-safe.pdf?sfvrsn=fc114686_14) |
| **H.870** Mode 2 (children / conservative) | **75 dBA for 40 h/week** = 0.51 Pa²h | **3 dB** | same |
| **NIOSH REL** | 85 dBA, 8 h TWA | 3 dB | [OSHA Technical Manual III:5](https://www.osha.gov/otm/section-3-health-hazards/chapter-5) |
| **OSHA PEL** | 90 dBA, 8 h TWA | 5 dB | same |
| H.870 device behaviour | track a "sound allowance" as % of reference exposure; **warn at 80 % and 100 %**; if unacknowledged, auto-reduce to ≤ 80/75 dBA | | [Hearing Review, PDF](https://www.efhoh.org/wp-content/uploads/2021/04/Hearing-Review-Sept-2020-Standard-for-Safe-Listening.pdf) |

#### H.870 Mode 1 allowance (3 dB exchange, 40 h @ 80 dBA)

| Level | Hours/week allowed | % of a 168 h week |
|---|---|---|
| 60 dBA | 4064 h | 2419 % |
| 65 dBA | 1280 h | 762 % |
| **70 dBA** | **403 h** | **240 %** |
| 73 dBA | 202 h | 120 % |
| 75 dBA | 127 h | 76 % |
| 78 dBA | 63.5 h | 38 % |
| **80 dBA** | **40 h** | 24 % |
| 83 dBA | 20 h | 12 % |
| 86 dBA | 10 h | 6 % |
| 89 dBA | 5 h | 3 % |

(80/83/86/89 confirmed in the [WHO Q&A on safe listening](https://www.who.int/news-room/questions-and-answers/item/deafness-and-hearing-loss-safe-listening); lower rows derived from the 3 dB rule.)

#### The maximum level Dampen may output

| Usage pattern | H.870 adult (80/40h) | H.870 child (75/40h) | NIOSH | OSHA (5 dB ER) |
|---|---|---|---|---|
| **24/7 (168 h/wk)** | **73.8 dBA** | **68.8 dBA** | 78.8 dBA | 79.6 dBA |
| 8 h/day × 7 (56 h/wk) | 78.5 dBA | 73.5 dBA | 83.5 dBA | — |
| 4 h/day × 7 (28 h/wk) | 81.5 dBA | 76.5 dBA | 86.5 dBA | — |

> **Recommendation: cap sustained output at ≤ 70 dBA** — 240 % of a continuous week's headroom under H.870 adult, and still ~2.4× headroom for children at 68.8 dBA.

This cap **never binds on the design**, which is the point: Dampen's target is 45–55 dBA (§4.1) and its masking bed is capped at 42–48 dBA (§3.3), both far below 70 dBA. The only way a user reaches 70 dBA is by overriding the volume, so that is where a soft warning belongs.

#### Two things worth stating explicitly

1. **You cannot ethically replicate the noise-research levels.** Every study in the stochastic-resonance literature (§3.2) used **78–85 dB**, which exceeds *every* guideline above for sustained use. Dampen's noise bed runs 25–35 dB below those levels. **None of those effect sizes transfer quantitatively**, and the product must not cite them as if they did.
2. **Precedent for shipping a noise generator without a level cap.** A 2014 *Pediatrics* study of 14 infant sound machines found all could exceed **50 dBA at 30 cm** and **three exceeded 85 dBA** ([primary](https://www.sciencedirect.com/science/article/abs/pii/S0165587621001506); [summary](https://www.mamazing.com/blogs/guides/is-white-noise-safe-for-babies-complete-safety-guide)). On the reassuring side, on sound masking specifically: "there is no evidence that reasonable levels of masking cause hearing damage" ([Chanaud, PDF](https://www.atlasied.com/f/3885/AtlasIED_Sound_Masking_Further_Thoughts.pdf)).

**Concrete implementation:** clamp the sum of `outputGain` and any user volume so the integrated output cannot exceed −20 LUFS *relative to the user's calibrated reference*; absent calibration, cap `outputGain` at 0 dB, cap `ambience.level` at −26 dBFS, and show a one-time note if the user holds the system volume high for more than an hour.

---

## 5. Web Audio API implementation notes

Primary sources: [W3C Web Audio API 1.1 Editor's Draft](https://webaudio.github.io/web-audio-api/), the [RBJ Audio EQ Cookbook](https://webaudio.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html), and the engine sources (Blink `third_party/blink/renderer/platform/audio/*`, Gecko `dom/media/webaudio/blink/Biquad.cpp`, WebKit `Source/WebCore/platform/audio/Biquad.cpp`). Where exactness matters the spec is quoted.

### 5.0 Node map for Dampen's chain

| `DampenParams` field | Node(s) | Notes |
|---|---|---|
| `highpass` | 1 × `BiquadFilterNode{type:'highpass'}` | **Q is in dB** — see §5.1 |
| `lowShelf` | 1 × `BiquadFilterNode{type:'lowshelf'}` | Q unused; slope fixed |
| `lowpass` | `stages` × `BiquadFilterNode{type:'lowpass'}` | Butterworth Qs, §5.1.4 |
| `presenceDip` | 1 × `BiquadFilterNode{type:'peaking'}` | Q is **linear** here |
| `tilt` | 1 × `BiquadFilterNode{type:'highshelf'}` with negative gain | approximates the X-curve |
| `reverb` | `ConvolverNode` + dry/wet `GainNode`s + `DelayNode` (pre-delay) | IR synthesised, §5.2 |
| `width` | `ChannelSplitter` → `Gain`×6 → `ChannelMerger` (M/S) | §5.6 |
| `compressor` | `DynamicsCompressorNode` **or** `AudioWorkletNode` | native node is crippled, §5.3 |
| `saturation` | `WaveShaperNode{oversample:'4x'}` | §5.4 |
| `wowFlutter` | `AudioWorkletNode` (fractional-delay line) | §5.5 |
| `bitcrush` | `AudioWorkletNode` | §5.5 |
| `ambience` | `AudioWorkletNode` (noise) + shaping biquads + `GainNode` | §5.5 |
| `drift` | `OscillatorNode` → `GainNode` → `outputGain.gain` | a-rate param input, §5.7 |
| `outputGain` | `GainNode` | §5.7 |

### 5.1 BiquadFilterNode

#### 5.1.1 Transfer function (spec §1.13.5, normative)

> "The formulas in this section describe the filters that a conforming implementation **MUST** implement… They are inspired by formulas found in the Audio EQ Cookbook."

```
H(z) = (b0/a0 + (b1/a0)z⁻¹ + (b2/a0)z⁻²) / (1 + (a1/a0)z⁻¹ + (a2/a0)z⁻²)
a0·y(n) + a1·y(n−1) + a2·y(n−2) = b0·x(n) + b1·x(n−1) + b2·x(n−2)
```
"The initial filter state is 0."

#### 5.1.2 Intermediate variables — note there are **two** different alphas

```
A      = 10^(G/40)                     // G = gain AudioParam, dB
ω₀     = 2π·f₀/Fs                      // f₀ = computedFrequency
α_Q    = sin(ω₀) / (2Q)                // Q as a LINEAR Q
α_QdB  = sin(ω₀) / (2 · 10^(Q/20))     // Q as DECIBELS  ← lowpass / highpass ONLY
S      = 1                             // shelf slope, HARD-CODED to 1
α_S    = (sin(ω₀)/2)·√((A + 1/A)(1/S − 1) + 2)   // with S=1 ⇒ (sin ω₀/2)·√2
```

Because `S` is hard-coded to 1, **`Q` is unused for `lowshelf`/`highshelf` and their slope is not adjustable.** For a gentler shelf you must cascade/blend or use `IIRFilterNode` with cookbook coefficients computed for S < 1 (`1/Q = √((A+1/A)(1/S−1)+2)`).

`computedFrequency(t) = frequency(t) · 2^(detune(t)/1200)`, nominal range `[0, Nyquist]`. `frequency` and `detune` are both a-rate and form a *compound parameter*.

#### 5.1.3 Coefficients per type (verbatim, spec §1.13.5)

| type | b0 | b1 | b2 | a0 | a1 | a2 |
|---|---|---|---|---|---|---|
| **lowpass** | (1−cos ω₀)/2 | 1−cos ω₀ | (1−cos ω₀)/2 | 1+**α_QdB** | −2cos ω₀ | 1−**α_QdB** |
| **highpass** | (1+cos ω₀)/2 | −(1+cos ω₀) | (1+cos ω₀)/2 | 1+**α_QdB** | −2cos ω₀ | 1−**α_QdB** |
| **bandpass** | α_Q | 0 | −α_Q | 1+α_Q | −2cos ω₀ | 1−α_Q |
| **notch** | 1 | −2cos ω₀ | 1 | 1+α_Q | −2cos ω₀ | 1−α_Q |
| **allpass** | 1−α_Q | −2cos ω₀ | 1+α_Q | 1+α_Q | −2cos ω₀ | 1−α_Q |
| **peaking** | 1+α_Q·A | −2cos ω₀ | 1−α_Q·A | 1+α_Q/A | −2cos ω₀ | 1−α_Q/A |
| **lowshelf** | A[(A+1)−(A−1)cos ω₀+2α_S√A] | 2A[(A−1)−(A+1)cos ω₀] | A[(A+1)−(A−1)cos ω₀−2α_S√A] | (A+1)+(A−1)cos ω₀+2α_S√A | −2[(A−1)+(A+1)cos ω₀] | (A+1)+(A−1)cos ω₀−2α_S√A |
| **highshelf** | A[(A+1)+(A−1)cos ω₀+2α_S√A] | −2A[(A−1)+(A+1)cos ω₀] | A[(A+1)+(A−1)cos ω₀−2α_S√A] | (A+1)−(A−1)cos ω₀+2α_S√A | 2[(A−1)−(A+1)cos ω₀] | (A+1)−(A−1)cos ω₀−2α_S√A |

Note Web Audio's `bandpass` is the cookbook's **constant 0 dB peak gain** BPF (`b0 = α, b2 = −α`), not the constant-skirt one.

#### 5.1.4 ⚠ THE BIG ONE: `Q` is in **decibels** for lowpass and highpass

Spec §1.13.2, `Q` attribute, verbatim:

> "For **lowpass** and **highpass** filters the `Q` value is **interpreted to be in dB**. For these filters the nominal range is [−Q_lim, Q_lim] where Q_lim is the largest value for which 10^(Q/20) does not overflow. This is approximately **770.63678**.
> For the **bandpass, notch, allpass,** and **peaking** filters, this value is a **linear** value…
> This is **not used** for the lowshelf and highshelf filters."

All three engines agree — this is not a Chrome quirk:

```cpp
// Blink: third_party/blink/renderer/platform/audio/biquad.cc  SetLowpassParams
resonance = pow10(resonance / 20);
double theta = std::numbers::pi * cutoff;       // cutoff normalised to Nyquist ⇒ theta == ω₀
double alpha = fdlibm::sin(theta) / (2 * resonance);
```
```cpp
// WebKit: Source/WebCore/platform/audio/Biquad.cpp
resonance = pow(10.0, 0.05 * resonance);
double alpha = sin(theta) / (2 * resonance);
```
```cpp
// Gecko: dom/media/webaudio/blink/Biquad.cpp (algebraically identical)
double g = fdlibm_pow(10.0, -0.05 * resonance);
double alpha = 0.5 * fdlibm_sin(w0) * g;
```

**The identity to memorise: for Web Audio lowpass/highpass, the magnitude *at* the cutoff frequency, in dB, equals the `Q` value.** `|H(ω₀)| = 10^(Q_dB/20)`. Measured (f₀ = 1 kHz, 48 kHz):

| `Q.value` (dB) | Q_linear | gain @ f₀ | peak | −3 dB point |
|---|---|---|---|---|
| −6.0000 | 0.5012 | −6.00 dB | none | 645 Hz |
| **−3.0103** | **0.7071** | −3.01 dB | **none (Butterworth)** | **999 Hz** |
| 0 | 1.0000 | 0.00 dB | +1.25 dB @ 708 Hz | 1270 Hz |
| **+1 (the default!)** | **1.1220** | +1.00 dB | **+1.96 dB @ 776 Hz** | 1328 Hz |
| +12 | 3.9811 | +12.00 dB | +12.07 dB | 1533 Hz |

Consequences, all of which will bite:

- **The default `Q = 1` is not Butterworth.** It is `Q_linear = 1.122` with a ~2 dB resonant bump at ~0.78·f₀. For a clean muffle you want **`Q.value = −3.0103`**.
- `Q = 0` does **not** mean "no resonance" — it means `Q_linear = 1`.
- `filter.Q.value = 0.0001` (seen in real libraries, e.g. reverbGen) is ≈ 0 dB ⇒ `Q_linear ≈ 1.0`, **not** a critically-damped filter.
- Negative `Q` is legal and useful here (it damps). For peaking/bandpass/notch/allpass, negative Q is nonsense — Blink clamps peaking with `q = std::max(0.0, q)` ("Don't let Q go negative, which causes an unstable filter").
- Engine edge cases not in the spec prose: for lowpass, `f₀ == Nyquist` ⇒ H(z) = 1 (passthrough) and `f₀ == 0` ⇒ H(z) = 0 (silence). **For highpass it is the reverse — automating a highpass's `frequency` down to 0 makes it a passthrough, not silence.**

> **🔴 CONTRACT NOTE FOR `lib/types.ts`.** `LowpassParams.q` is documented as *"Resonance. Keep ≤ 1.0 or the cutoff whistles"*, which is the **linear** convention. The preset tables in §8 use that linear convention, because it is the documented contract. **The engine must therefore convert before assigning:**
> ```ts
> // lowpass / highpass ONLY
> filter.Q.value = 20 * Math.log10(params.lowpass.q);   // 0.7071 → −3.0103
> // peaking / notch / bandpass / allpass: assign directly, no conversion
> peak.Q.value = params.presenceDip.q;
> // lowshelf / highshelf: do not set Q at all, it is ignored
> ```
> Assigning `q = 0.7071` directly to `Q.value` would give `Q_linear = 1.085` — a filter with a resonant bump where you wanted maximally flat. This is the single most likely silent bug in the whole engine.

#### 5.1.5 Attribute reference

| param | default | min | max | rate |
|---|---|---|---|---|
| `frequency` | 350 | 0 | Nyquist | a-rate |
| `detune` | 0 | ≈ −153600 | ≈ 153600 | a-rate |
| `Q` | **1** | most-negative float | most-positive float (real limit ±770.64 for LP/HP) | a-rate |
| `gain` | 0 | most-negative float | ≈ 1541 (`40 log₁₀ FLT_MAX`) | a-rate |

> "All attributes of the BiquadFilterNode are **a-rate** AudioParams."

Node: 1 in / 1 out, `channelCount 2`, `channelCountMode "max"`, `channelInterpretation "speakers"`, **tail-time: yes** (IIR ⇒ theoretically infinite). Output channel count always equals input channel count.

> "While fixed filters are stable, it is possible to create **unstable** biquad filters using automations of AudioParams. It is the developer's responsibility to manage this." and "The UA may produce a warning to notify the user that **NaN** values have occurred in the filter state."

`getFrequencyResponse(frequencyHz, magResponse, phaseResponse)` — all three must be same-length `Float32Array` or `InvalidAccessError`; out-of-range frequencies yield `NaN`; computed from params "sampled for the current processing block", so it reflects automation. **Use this to draw Dampen's EQ curve in the UI — do not re-implement the maths.**

#### 5.1.6 Cascading for steeper slopes

One biquad = 2nd order = 12 dB/oct. N identical sections = 12N dB/oct, **but the −3 dB point moves down** because each section contributes its own −3 dB at f₀.

**Correction factor.** For N cascaded *identical* Butterworth 2nd-order sections, solve `(1+(f/f_c)⁴)^(N/2) = √2`:

```
f₋₃dB / f_c = (2^(1/N) − 1)^(1/4)        // 2nd-order sections
f₋₃dB / f_c = (2^(1/N) − 1)^(1/2)        // 1st-order sections
f₋₃dB / f_c = (2^(1/N) − 1)^(1/(2n))     // general: n-th order sections
```

To place the true −3 dB corner at `F`, set each section's `frequency` to `F / (2^(1/N)−1)^(1/4)`:

| N | order | slope | f₋₃dB/f_c | **f_c multiplier** |
|---|---|---|---|---|
| 1 | 2 | 12 dB/oct | 1.0000 | 1.0000 |
| **2** | **4** | **24 dB/oct** | 0.80224 | **1.24651** |
| **3** | **6** | **36 dB/oct** | 0.71402 | **1.40052** |
| **4** | **8** | **48 dB/oct** | 0.65953 | **1.51623** |
| 6 | 12 | 72 dB/oct | 0.59156 | 1.69044 |
| 8 | 16 | 96 dB/oct | 0.54849 | 1.82318 |

Verified numerically (f₀ = 1 kHz, 48 kHz, Q = −3.0103 dB): N = 2 → actual −3 dB at 801.8 Hz vs predicted 802.2; N = 4 → 659.4 vs 659.5.

**Proper Butterworth (maximally flat) alternative** — better, and what Dampen should use. Instead of identical sections, use the Butterworth pole Qs: `Q_k = 1/(2 cos θ_k)`, `θ_k = (2k+1)π/(2·N_order)`. These give a flat passband *and* leave the −3 dB point exactly at f₀:

| order | sections | Q_linear | **Q.value in dB (what you actually assign)** |
|---|---|---|---|
| **2** | 1 | 0.707107 | **−3.0103** |
| **4** | 2 | 0.541196, 1.306563 | **−5.3329, +2.3226** |
| **6** | 3 | 0.517638, 0.707107, 1.931852 | **−5.7195, −3.0103, +5.7195** |
| **8** | 4 | 0.509796, 0.601345, 0.899976, 2.562915 | **−5.8521, −4.4175, −0.9154, +8.1747** |
| 10 | 5 | 0.506233, 0.561163, 0.707107, 1.101345, 3.196227 | −5.9130, −5.0182, −3.0103, +0.8385, +10.0928 |
| 12 | 6 | 0.504314, 0.541196, 0.630236, 0.821340, 1.306563, 3.830649 | −5.9460, −5.3329, −4.0099, −1.7095, +2.3226, +11.6654 |

Verified: two sections at those Qs, f₀ = 1 kHz → −0.017 dB @ 500 Hz, −3.010 dB @ 1 kHz, −24.25 dB @ 2 kHz, −48.92 dB @ 4 kHz. Textbook 4th-order Butterworth.

```js
const BUTTER_Q = {
  2:  [0.707107],
  4:  [0.541196, 1.306563],
  6:  [0.517638, 0.707107, 1.931852],
  8:  [0.509796, 0.601345, 0.899976, 2.562915],
};
const toQdB = q => 20 * Math.log10(q);   // ONLY for 'lowpass' / 'highpass'

function butterworth(ctx, type /* 'lowpass'|'highpass' */, freq, stages = 2) {
  const qs = BUTTER_Q[stages * 2];                  // stages → filter order
  const sections = qs.map(q => new BiquadFilterNode(ctx, {
    type, frequency: freq, Q: toQdB(q),             // ← dB, not linear
  }));
  for (let i = 0; i < sections.length - 1; i++) sections[i].connect(sections[i + 1]);
  return {
    input: sections[0],
    output: sections[sections.length - 1],
    sections,
    setFrequency(hz, t, tau = 0.08) {               // see §5.7
      for (const s of sections) s.frequency.setTargetAtTime(hz, t, tau);
    },
  };
}
```

**Note on `stages`:** `DampenParams.lowpass.stages` is documented as "Each stage adds ~12 dB/oct. 1..4 ⇒ 12..48 dB/oct". With the Butterworth table above, `stages = n` means a filter of **order 2n** built from `n` biquads with the `BUTTER_Q[2n]` Qs. That is the right reading and gives exactly the documented slopes with a flat passband.

**Cost is negligible.** Per padenot, biquads are "relatively cheap (five multiplication and four additions per sample)" with "four floats" of state ([web-audio-perf](https://padenot.github.io/web-audio-perf/)). Stacking 8 is free compared with one `ConvolverNode`.

#### 5.1.7 IIRFilterNode (arbitrary coefficients)

```js
const iir = new IIRFilterNode(ctx, { feedforward: [b0,b1,…], feedback: [a0,a1,…] });
// H(z) = Σ b_m z^−m / Σ a_n z^−n
```

Spec advice, verbatim:

> "In general, it is best to use BiquadFilterNode's to implement higher-order filters for the following reasons: Generally less sensitive to numeric issues; **Filter parameters can be automated**; Can be used to create all even-ordered IIR filters. However, **odd-ordered filters cannot be created**…"
> "**Once created, the coefficients of the IIR filter cannot be changed.**"

- Max array length **20** each. `NotSupportedError` if length 0 or > 20; `InvalidStateError` if all feedforward are zero or `feedback[0] === 0`.
- **No AudioParams at all ⇒ no automation, no sweeps.** To "sweep" you must create a new node and cross-fade. This makes it unsuitable as Dampen's main muffle filter but **perfect for fixed filters: K-weighting (§5.8), the RIAA curve, a measured wall transfer function.**
- Has `getFrequencyResponse()` with the same semantics as biquad. Tail-time yes.
- Numerically a single direct form with up to 20 taps — high-order designs **will** be sensitive. Factor into biquads where you can.

### 5.2 ConvolverNode and procedural IR synthesis

#### 5.2.1 Node constraints (spec §1.17)

- 1 in / 1 out, `channelCount 2` (**constrained**), `channelCountMode "clamped-max"` (**constrained**), `channelInterpretation "speakers"`, tail-time = buffer length.
- "The input of this node is either mono (1 channel) or stereo (2 channels) and **cannot be increased**."
- Setting `.buffer`: "If the buffer number of channels is **not 1, 2, 4**, or if the **sample-rate of the buffer is not the same as the sample-rate of its associated BaseAudioContext**, a `NotSupportedError` MUST be thrown." → **always generate IRs at `ctx.sampleRate`.** A 3-channel buffer throws.
- "The ConvolverNode produces a **mono output only** in the single case where there is a single input channel and a single-channel buffer. In all other cases, the output is **stereo**." A 4-channel buffer with 2-channel input gives "matrix 'true' stereo convolution" (and runs 4 convolvers).
- > "**If the buffer is set to a new buffer, audio may glitch.** If this is undesirable, it is recommended to create a new ConvolverNode to replace the old, possibly cross-fading between the two."

#### 5.2.2 `normalize` — the exact spec algorithm, and why you should disable it

> "Controls whether the impulse response from the buffer will be scaled by an **equal-power normalization** when the buffer attribute is set. Its default value is **true**… **Changes to this value do not take effect until the next time the `buffer` attribute is set.**"

```js
function calculateNormalizationScale(buffer) {      // verbatim from the spec
  const GainCalibration = 0.00125;
  const GainCalibrationSampleRate = 44100;
  const MinPower = 0.000125;
  const numberOfChannels = buffer.numberOfChannels;
  const length = buffer.length;
  let power = 0;
  for (let i = 0; i < numberOfChannels; i++) {
    let channelPower = 0;
    const channelData = buffer.getChannelData(i);
    for (let j = 0; j < length; j++) { const s = channelData[j]; channelPower += s * s; }
    power += channelPower;
  }
  power = Math.sqrt(power / (numberOfChannels * length));
  if (!isFinite(power) || isNaN(power) || power < MinPower) power = MinPower;
  let scale = 1 / power;
  scale *= GainCalibration;                                    // ≈ 10^(−58/20)
  if (buffer.sampleRate) scale *= GainCalibrationSampleRate / buffer.sampleRate;
  if (numberOfChannels == 4) scale *= 0.5;                      // true-stereo comp
  return scale;
}
```
Blink matches exactly (`reverb.cc`): `constexpr float kGainCalibration = -58;` → 10^(−2.9) = 0.0012589, `kMinPower = 0.000125f`.

**Two consequences Dampen will hit:**

1. **Normalisation is RMS-based, so IR length changes loudness.** Doubling the tail halves the RMS and roughly doubles the applied gain. Since `reverb.decay` is a user-facing parameter, the wet level would jump around as the user drags it.
2. **At 48 kHz you get 44100/48000 = 0.919× (−0.73 dB) less** than at 44.1 kHz for the same IR — a silent cross-device level difference.

```js
// Deterministic level: disable normalisation and manage gain yourself.
const conv = new ConvolverNode(ctx, { disableNormalization: true });
conv.buffer = ir;    // set normalize/disableNormalization BEFORE buffer
```

#### 5.2.3 Exponentially-decaying noise IR — the math

RT60 is the time to decay 60 dB = an amplitude factor of 10^(−60/20) = **1/1000**. So from `e^(−k·RT60·fs) = 10⁻³`:

```
k = ln(1000) / (RT60 · fs),      ln(1000) = 6.907755278982137
ir[n] = (2·random() − 1) · exp(−k·n)
```

```js
function makeNoiseIR(ctx, { rt60 = 1.2, channels = 2, tailFactor = 1.5 } = {}) {
  const fs  = ctx.sampleRate;                        // MUST equal context rate
  const N   = Math.round(rt60 * tailFactor * fs);    // 1.5× RT60 ⇒ ≈ −90 dB at the end
  const k   = 6.907755278982137 / (rt60 * fs);
  const buf = ctx.createBuffer(channels, N, fs);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    let mean = 0;
    for (let n = 0; n < N; n++) { const v = (2 * Math.random() - 1) * Math.exp(-k * n); d[n] = v; mean += v; }
    mean /= N;
    for (let n = 0; n < N; n++) d[n] -= mean;         // kill the DC pedestal
    const fo = Math.round(0.005 * fs);                // 5 ms fade-out: no truncation click
    for (let n = 0; n < fo; n++) d[N - 1 - n] *= n / fo;
  }
  return buf;
}
```

Equivalent formulations, all seen in the wild:

| Form | Note |
|---|---|
| `exp(−n · ln(1000)/(RT60·fs))` | exact RT60; **what you want** |
| `base ** n`, `base = (1/1000)**(1/(RT60·fs))` | identical, cheaper; reverbGen uses this |
| `(1 − n/N) ** decay` | polynomial; **not** exponential. Reaches exactly 0 at n = N (no truncation click) but RT60 is implicit. `decay ≈ 2` is the common default |
| `exp(−n·3/N)` | "3 time constants" shorthand ≈ **−26 dB only** — usually far too short |

The exponential form needs the explicit fade-out above, or percussive input produces a click at IR end. Moorer's observation ("About This Reverberation Business", 1979) that exponentially-decaying white noise makes a surprisingly good reverb IR is the basis of this whole approach.

#### 5.2.4 A "next room" IR — concrete algorithm

Physically (per §2.1): the direct path is *occluded* (heavily lowpassed and attenuated, not removed); there is a short pre-delay while sound goes around and through; a few discrete early reflections from the near room; and a diffuse tail whose HF decays much faster.

```js
function makeNextRoomIR(ctx, opts = {}) {
  const {
    preDelayMs    = 12,     // 8–20 ms: arrival around/through the partition
    directGainDb  = -22,    // occluded direct path level (§2.2: −20…−28 dB)
    // early reflections: [time ms, gain, polarity]. Mutually non-harmonic ms values
    // (11/17/23/29/37/43) avoid comb flutter.
    early = [[11,0.42,+1],[17,0.33,-1],[23,0.28,+1],[29,0.22,-1],[37,0.18,+1],[43,0.14,-1]],
    rt60Low       = 0.62,   // LF decay of the FAR room (§2.9: domestic 0.3–0.8 s)
    tailLpHz      = 1100,   // diffuse tail brightness ceiling
    partitionHz   = 80,     // mass-air-mass resonance (§2.1)
    coincidenceHz = 2200,   // the wall's coincidence leak (§2.1)
    channels      = 2,
  } = opts;

  const fs = ctx.sampleRate;
  const N  = Math.round((preDelayMs / 1000 + rt60Low * 1.5) * fs);
  const raw = ctx.createBuffer(channels, N, fs);
  const preDelay = Math.round(preDelayMs * fs / 1000);
  const kLow = 6.907755278982137 / (rt60Low * fs);

  for (let c = 0; c < channels; c++) {
    const d = raw.getChannelData(c);

    // (i) occluded direct path: one impulse, lowpassed hard in the offline pass
    d[0] += Math.pow(10, directGainDb / 20);

    // (ii) discrete early reflections, decorrelated per channel
    const jitter = c === 0 ? 1 : 1.07;
    for (const [ms, g, pol] of early) {
      const i = Math.round(ms * jitter * fs / 1000);
      if (i < N) d[i] += pol * g * (0.85 + 0.3 * Math.random());
    }

    // (iii) diffuse tail from preDelay, with a 6 ms raised-cosine fade-in
    //       so the tail doesn't itself begin as a transient
    const fadeIn = Math.round(0.006 * fs);
    for (let n = preDelay; n < N; n++) {
      const t   = n - preDelay;
      const env = Math.exp(-kLow * t);
      const win = t < fadeIn ? 0.5 - 0.5 * Math.cos(Math.PI * t / fadeIn) : 1;
      d[n] += (2 * Math.random() - 1) * env * win * 0.9;
    }
    const fo = Math.round(0.005 * fs);
    for (let n = 0; n < fo; n++) d[N - 1 - n] *= n / fo;
  }

  // (iv) shape the whole IR offline through the "wall" transfer function
  return renderIRThroughGraph(ctx, raw, (oc, src, dst) => {
    const lp1 = new BiquadFilterNode(oc, { type:'lowpass',  frequency: tailLpHz, Q: -5.3329 });
    const lp2 = new BiquadFilterNode(oc, { type:'lowpass',  frequency: tailLpHz, Q: +2.3226 });
    const hp  = new BiquadFilterNode(oc, { type:'highpass', frequency: 30,  Q: -3.0103 });  // DC only
    const res = new BiquadFilterNode(oc, { type:'peaking',  frequency: partitionHz,   Q: 1.5, gain: +4 });
    const coi = new BiquadFilterNode(oc, { type:'peaking',  frequency: coincidenceHz, Q: 2.0, gain: +5 });
    src.connect(lp1).connect(lp2).connect(hp).connect(res).connect(coi).connect(dst);

    // frequency-dependent decay for free: close the lowpass over the tail
    for (const f of [lp1, lp2]) {
      f.frequency.setValueAtTime(tailLpHz, 0);
      f.frequency.exponentialRampToValueAtTime(Math.max(160, tailLpHz * 0.2), rt60Low);
    }
  });
}

async function renderIRThroughGraph(ctx, buffer, wire) {
  const oc  = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, ctx.sampleRate);
  const src = new AudioBufferSourceNode(oc, { buffer });
  wire(oc, src, oc.destination);
  src.start();
  return oc.startRendering();
}
```

**Reference ms values:** wall/door pre-delay **8–20 ms**; early reflections in a normal room **8–45 ms** (use mutually non-harmonic values); diffuse onset by **~40–60 ms**; small far room RT60 **0.3–0.8 s**, corridor **0.8–1.5 s**. For "muffled music in the next room" the wall dominates: **2nd-to-4th-order lowpass at 300–600 Hz on the direct path at −15…−25 dB**, tail ceiling **800–1500 Hz**.

#### 5.2.5 Frequency-dependent decay (shorter RT60 at HF)

Real rooms have RT60(f) falling with frequency (air absorption plus absorbent surfaces). Two implementations:

**Method A — multiband noise with separate envelopes (most control).** The trick: `setTargetAtTime(0, t₀, τ)` gives exactly `v(t) = V₀·e^(−(t−t₀)/τ)`, so with **`τ = RT60/ln(1000)`** you land on −60 dB precisely at RT60 — the same constant as §5.2.3.

```js
async function makeMultibandIR(ctx, {
  bands = [                   // [loHz, hiHz, rt60 s, level dB]
    [    0,   250, 0.95,  0],
    [  250,  1000, 0.70, -1],
    [ 1000,  4000, 0.40, -4],
    [ 4000, 20000, 0.22, -9],
  ],
  channels = 2, lengthS = 1.6,
} = {}) {
  const fs = ctx.sampleRate, N = Math.round(lengthS * fs);
  const oc = new OfflineAudioContext(channels, N, fs);

  for (const [lo, hi, rt60, dB] of bands) {
    const nb = oc.createBuffer(channels, N, fs);        // independent noise per band
    for (let c = 0; c < channels; c++) {
      const d = nb.getChannelData(c);
      for (let n = 0; n < N; n++) d[n] = 2 * Math.random() - 1;
    }
    const src = new AudioBufferSourceNode(oc, { buffer: nb });
    let node = src;
    if (lo > 0)    { const f = new BiquadFilterNode(oc,{type:'highpass',frequency:lo,Q:-3.0103}); node = node.connect(f); }
    if (hi < fs/2) { const f = new BiquadFilterNode(oc,{type:'lowpass', frequency:hi,Q:-3.0103}); node = node.connect(f); }
    const g = new GainNode(oc, { gain: 0 });
    node.connect(g).connect(oc.destination);

    g.gain.setValueAtTime(Math.pow(10, dB / 20), 0);
    g.gain.setTargetAtTime(0, 0, rt60 / 6.907755278982137);   // exact per-band RT60
    src.start(0);
  }
  return oc.startRendering();
}
```

**Method B — time-varying lowpass over the tail (cheap, one pass).** Render one noise burst through a lowpass whose cutoff ramps down over the decay — shown in §5.2.4, and what [reverbGen](https://github.com/adelespinasse/reverbGen) (Apache-2.0) does with `lpFreqStart`/`lpFreqEnd`:

```js
// reverbGen, src/lib/index.ts — note the Q value and what it really means
const decayBase = Math.pow(1 / 1000, 1 / decaySampleFrames);   // −60 dB == 1/1000 amplitude
chan[j] = randomSample() * Math.pow(decayBase, j);
// …then offline:
filter.type = 'lowpass';
filter.Q.value = 0.0001;                   // ← per §5.1.4 this is dB ⇒ Q_linear ≈ 1.0
filter.frequency.setValueAtTime(lpFreqStart, 0);
filter.frequency.linearRampToValueAtTime(lpFreqEnd, lpFreqEndAt);
```
**Dampen's `reverb.damping` maps directly onto Method B's ramp end frequency**, and `reverb.size` onto the early-reflection spacing in §5.2.4.

#### 5.2.6 ConvolverNode gotchas

- **No wet/dry built in.** Build it: `src → dryGain → out` and `src → preDelay → wetGain → convolver → out`. For constant perceived loudness as `reverb.mix` moves, use a power-complementary law: `dry = cos(m·π/2)`, `wet = sin(m·π/2)`.
- **Latency: zero in Chrome.** `ReverbConvolver::LatencyFrames()` returns `0`; `reverb_convolver.cc` comments *"The total latency is zero because the direct-convolution is used in the leading portion."* It then uses non-uniform partitioning: `kMinFFTSize = 128`, doubling per stage to `kMaxFftSize = 8192`, with FFTs staggered across render quanta. **No delay compensation needed** — unlike oversampled `WaveShaper` or the compressor.
- **CPU.** padenot: "Very expensive, and depending on the duration of the convolution impulse." Cost scales with IR length **and channel count**. Rule of thumb: **one stereo convolver with a ≤ 2 s IR is fine everywhere; 4+ simultaneous convolvers or > 4 s IRs will drop out on mobile.**
- **Setting `.buffer` blocks the main thread.** The RMS scan plus FFT-ing the IR into stages happens synchronously in the setter. padenot's measurements: "the rate at which the impulse is prepared is around 15 milliseconds of computation for a second of impulse (**35 ms for Chrome**)… at least a frame is dropped if the impulse is more than 1 second (0.5 second for Chrome) and the UA renders at 60fps." **Pre-render all Dampen IRs at load time**, keep a pool of convolvers, and cross-fade between them when the user changes `reverb.decay`. (Open spec issue: [WebAudio/web-audio-api#2449](https://github.com/WebAudio/web-audio-api/issues/2449).)
- **Memory** ≈ `length × channels × 4 bytes` for the AudioBuffer, plus a full internal copy, plus FFT stage buffers — call it 2–3× total. A 5 s stereo IR at 48 kHz ≈ 1.9 MB of samples, ~6 MB resident. **Keep Dampen's IRs under ~2 s.**
- **Don't let a synthesised IR carry DC.** `(2*Math.random()−1)` is zero-mean in expectation, but a finite IR has a non-zero sample mean which becomes a DC pedestal on every transient. Subtract the mean (as in §5.2.3) or put a 20–30 Hz highpass in the offline render.
- `normalize` must be set **before** `buffer`.
- Tail-time equals the buffer length, so the node keeps rendering (and keeps itself alive) after input stops.

### 5.3 DynamicsCompressorNode — and why Dampen should not rely on it

#### 5.3.1 Parameters (spec §1.19.2) — all **k-rate**

| param | spec wording | default | min | max |
|---|---|---|---|---|
| `threshold` | "The decibel value above which the compression will start taking effect." | −24 | **−100** | **0** |
| `knee` | "A decibel value representing the range above the threshold where the curve smoothly transitions to the 'ratio' portion." | 30 | 0 | **40** |
| `ratio` | "The amount of dB change in input for a 1 dB change in output." | 12 | **1** | **20** |
| `attack` | "**The amount of time (in seconds) to reduce the gain by 10 dB.**" | 0.003 | 0 | **1** |
| `release` | "**The amount of time (in seconds) to increase the gain by 10 dB.**" | 0.25 | 0 | **1** |
| `makeupGain` | NEW in the ED; "automatic" by default | 0 | −FLT_MAX | ≈1541 |
| `reduction` | **`readonly attribute float`** — "A read-only decibel value for metering purposes" | — | — | — |

> "The AudioParams `threshold`, `knee`, `ratio`, `attack`, `release`, and `makeupGain` **MUST be 'k-rate'**. An `InvalidStateError` must be thrown if the rate is changed to 'a-rate'."

Node: 1 in / 1 out, `channelCount 2` (constrained), `channelCountMode "clamped-max"` (constrained), tail-time yes "due to the look-ahead delay".

#### 5.3.2 The spec's algorithm (§1.19.4)

> "Fixed look-ahead (this means that a DynamicsCompressorNode adds a fixed latency to the signal chain). Configurable attack speed, release speed, threshold, knee hardness and ratio. **Side-chaining is not supported.** The gain reduction is reported via the `reduction` property."

The spec normatively describes it as this internal graph — note the **6 ms**:

```js
const delay = new DelayNode(context, {delayTime: 0.006});   // ← 6 ms, in the SPEC
const gain = new GainNode(context);
const compression = new EnvelopeFollower();
input.connect(delay).connect(gain).connect(output);
input.connect(compression).connect(gain.gain);
```

But the curve shapes are **left to the UA**: "User-agents are allowed to choose the shape of the envelope function", "From the threshold up to the knee end threshold, User-Agents can choose the curve shape." So `attack`/`release` only *may* control the curve. **The sonic behaviour of this node is not interoperable.** Automatic makeup gain is specified as `fullRangeGain = curve(1.0)`, `makeup = (1/fullRangeGain)^0.6`.

#### 5.3.3 What Chrome actually does

From `third_party/blink/renderer/platform/audio/dynamics_compressor.cc` — and Firefox ships a port of the same WebKit code, so this is the de-facto behaviour:

```cpp
constexpr float kMeteringReleaseTimeConstant = 0.325f;
constexpr float kPreDelay = 0.006f;                     // seconds ← the 6 ms look-ahead
constexpr float kSatReleaseTime = 0.0025f;
constexpr float kReleaseZone1 = 0.09f, kReleaseZone2 = 0.16f,
                kReleaseZone3 = 0.42f, kReleaseZone4 = 0.98f;   // 4th-order release fit
```

- **`CHECK_EQ(number_of_channels, 2u);`** with `// FIXME : support other number of channels.` — a hard-wired stereo processor.
- **Detector is a PEAK across channels, hard-linked**: `if (compressor_input < abs_undelayed_source) compressor_input = abs_undelayed_source;`. No stereo-link control, no RMS mode.
- **Knee is an exponential, not a dB-domain polynomial**: `KneeCurve(x,k) = linear_threshold + (1 − exp(−k(x − linear_threshold)))/k`, with `k` found by **bisection, 15 iterations**, to hit the requested slope.
- **Makeup gain is always on and uncontrollable**: `const float linear_post_gain = powf(1 / Saturate(1, k), 0.6f); // Makeup gain with empirical/perceptual tuning.` **This is why raising `ratio` or lowering `threshold` makes the output *louder* in a way you cannot defeat.**
- **The envelope rate is recomputed once per 32 frames** (`kNumberOfDivisionFrames = 32`), not per sample.
- **`attack` is not "time to 10 dB"** in any simple sense: `envelope_rate = 1 − powf(0.25f / db_eff_atten_diff, 1 / attack_frames)`, where `db_eff_atten_diff` depends on *how much* reduction is being requested.
- **Release is adaptive and cannot be disabled**: a 4th-order polynomial in the clamped compression difference (−12…0 dB); "higher compression releases faster".
- **A `sin()` warp is applied to the gain**: `post_warp_compressor_gain = sin(π/2 · compressor_gain)` "to smooth out sharp exponential transition points". The realised gain is not the envelope you think it is.

#### 5.3.4 The limitations, confirmed

1. **Fixed 6 ms pre-delay.** In a parallel dry/wet topology this comb-filters unless you delay the dry path by exactly 0.006 s. Nothing is exposed to query it.
2. **No sidechain.** Spec: "Side-chaining is not supported."
3. **No usable makeup gain in shipping browsers.** `makeupGain` + `enum MakeupGainOptions {"automatic"}` are in the ED but **neither engine has it** — Blink's `dynamics_compressor_node.idl` and Gecko's `DynamicsCompressorNode.webidl` list only `threshold, knee, ratio, reduction, attack, release`. The automatic `^0.6` makeup is mandatory. **`DampenParams.compressor.makeup` therefore must be a separate `GainNode`, not this param.**
4. **No stereo-link control**; always a 2-channel peak-linked detector.
5. **`ratio` max is 20** ⇒ not a limiter. Even at ratio 20 / knee 0, the exponential knee and `sin()` warp let overshoots through.
6. **Attack/release semantics are nonstandard and signal-dependent.** "3 ms attack" is not comparable to any plugin.
7. **`reduction` is a plain `float`**, not an AudioParam — you cannot connect or automate from it, only poll it from the main thread. (`EngineMeters.reduction` must be populated by polling.)
8. **All params k-rate** ⇒ one value per 128-frame block; no sample-accurate threshold sweeps.
9. **Cross-browser sound differs**, by design.

**Verdict for Dampen:** the native node is adequate for the "gentle levelling" use and for a v1, with `{threshold: −35, knee: 0, ratio: 12, attack: 0.003, release: 0.1}` landing close to §2.11's "flatten into a bed" row. But §4.1 specifies an **LRA target of 3–6 LU**, which is a measured outcome you cannot hit reliably with an uncontrollable adaptive release and a mandatory makeup gain. **Plan for an AudioWorklet compressor.**

#### 5.3.5 An AudioWorklet compressor (sidechain, lookahead, ratio > 20, a-rate)

```js
// compressor-processor.js
class Comp extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name:'threshold', defaultValue:-24, minValue:-100, maxValue:0,    automationRate:'a-rate' },
      { name:'ratio',     defaultValue:4,   minValue:1,    maxValue:1000, automationRate:'a-rate' }, // no 20 cap
      { name:'attack',    defaultValue:0.01,minValue:0,    maxValue:1,    automationRate:'k-rate' },
      { name:'release',   defaultValue:0.15,minValue:0,    maxValue:2,    automationRate:'k-rate' },
      { name:'knee',      defaultValue:6,   minValue:0,    maxValue:40,   automationRate:'k-rate' },
      { name:'makeup',    defaultValue:0,   minValue:-24,  maxValue:24,   automationRate:'a-rate' },
    ];
  }
  constructor() { super(); this.env = 0; }

  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], sc = inputs[1];   // input 1 = SIDECHAIN
    if (!inp.length) return true;
    const n = out[0].length;
    const det = (sc && sc.length) ? sc : inp;
    const at = p.attack[0], rl = p.release[0], knee = p.knee[0];
    const aA = at > 0 ? Math.exp(-1 / (at * sampleRate)) : 0;
    const aR = rl > 0 ? Math.exp(-1 / (rl * sampleRate)) : 0;

    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let c = 0; c < det.length; c++) { const v = Math.abs(det[c][i]); if (v > x) x = v; }
      const dbIn = 20 * Math.log10(Math.max(x, 1e-9));
      const T = p.threshold.length > 1 ? p.threshold[i] : p.threshold[0];
      const R = p.ratio.length     > 1 ? p.ratio[i]     : p.ratio[0];

      // standard quadratic (Reiss/Zölzer) soft knee, in dB
      const dbOver = dbIn - T;
      let gr = 0;
      if (knee > 0 && dbOver > -knee / 2 && dbOver <= knee / 2) {
        gr = (1 / R - 1) * Math.pow(dbOver + knee / 2, 2) / (2 * knee);
      } else if (dbOver > knee / 2) {
        gr = (1 / R - 1) * dbOver;
      }
      const a = (gr < this.env) ? aA : aR;          // attack when more reduction needed
      this.env = a * this.env + (1 - a) * gr;

      const mk = p.makeup.length > 1 ? p.makeup[i] : p.makeup[0];
      const g  = Math.pow(10, (this.env + mk) / 20);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] ? inp[c][i] : 0) * g;
    }
    return true;   // keep alive for the release tail
  }
}
registerProcessor('comp', Comp);
// main thread: new AudioWorkletNode(ctx, 'comp', { numberOfInputs: 2 })
```
For true look-ahead, buffer the signal path in a ring of `L` samples and run the detector `L` ahead; `L = 0.005·sampleRate` is plenty (§2.11: 5–10 ms catches sub-10 ms transients).

### 5.4 WaveShaperNode — saturation curve formulas

#### 5.4.1 Curve semantics (spec §1.31.2, normative)

> "The input signal is nominally within the range [−1, 1]. … Any sample value **less than −1 will correspond to the first value** in the curve array. Any sample value **greater than +1 will correspond to the last value**. The implementation **MUST perform linear interpolation** between adjacent points… Initially the curve attribute is **null**, which means that the WaveShaperNode will **pass its input to its output without modification**."

```
v = ((N − 1) / 2) · (x + 1)
k = ⌊v⌋,  f = v − k
y = c₀                        if v < 0
  = c_{N−1}                   if v ≥ N − 1
  = (1 − f)·c_k + f·c_{k+1}   otherwise
```

So `x = −1 ↦ c₀` and `x = +1 ↦ c_{N−1}`, and "a curve with an **even** number of values will **not have a value for a signal at zero**". **Use an odd length** (e.g. 4097) if you care about exact behaviour at zero.

- `InvalidStateError` if length < 2.
- "an internal copy of the curve is created… Subsequent modifications of the contents of the array used to set the attribute therefore **have no effect**."
- ⚠ **DC**: "The use of a curve that produces a non-zero output value for zero input value will cause this node to produce a **DC signal even if there are no inputs connected**. This will persist until the node is disconnected from downstream nodes." Asymmetric curves hit this — centre the curve so `f(0) = 0`, or follow it with a 10–20 Hz highpass.
- ⚠ **"curve can only be set once"**: the spec's setter algorithm says *"If new curve is not null and `[[curve set]]` is true, throw an `InvalidStateError`"*. **Blink does not implement this** (`WaveShaperNode::SetCurveImpl` has no such check), so Chrome lets you reassign. The contradictory prose was removed in [WebAudio/web-audio-api#1897](https://github.com/WebAudio/web-audio-api/issues/1897) but the setter algorithm still reads as one-shot. **Rely on neither** — to change `saturation`, build a new node and cross-fade (which you want anyway: swapping a curve mid-stream is a discontinuity).

#### 5.4.2 `oversample` — and why it is mandatory here

```
enum OverSampleType { "none", "2x", "4x" };   // default "none"
```
> "Up-sample the input samples to 2x or 4x the sample-rate … Apply the shaping curve … Down-sample the result back … The exact up-sampling and down-sampling filters **are not specified**."
> "Use of oversampling introduces some degree of audio processing **latency**… The amount of this latency can **vary from one implementation to another**."

Any non-linearity generates harmonics at `k·f`. At 48 kHz a 5 kHz input whose 7th harmonic lands at 35 kHz folds back to **13 kHz** — an inharmonic, un-maskable tone, and precisely in the band §1.4 says carries sibilance salience. **Use `'4x'` for anything with a knee; `'2x'` for mild saturation; `'none'` only for near-linear curves.** Note tail-time becomes "Maybe" ("only if the oversample attribute is set to 2x or 4x") and the latency is unspecified — so keep the shaper **in series**, never in a parallel dry/wet branch.

⚠ **WebKit bug**: a `WaveShaperNode` with a **null** curve still runs its oversampling filters, adding latency and HF filtering to a node that should be a passthrough (Safari 27.0.1 / Playwright WebKit 26.6). **When `saturation === 0`, set `oversample = 'none'` or disconnect the node** rather than leaving a null curve with oversampling on.

#### 5.4.3 The actual formulas

```js
const makeCurve = (n, f) => {                     // n odd ⇒ exact f(0)
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = f((i * 2) / (n - 1) - 1);
  return c;
};
```

| Curve | Formula | Character |
|---|---|---|
| **tanh (normalised)** | `y = tanh(k·x) / tanh(k)` | The workhorse. Odd-symmetric ⇒ odd harmonics only. `y(±1) = ±1` exactly, so no level loss. `k=1` near-linear, `k=3` obvious, `k=10` near-square |
| tanh (raw) | `y = tanh(k·x)` | `y(1) = tanh(k) < 1` ⇒ loses level |
| **arctangent** | `y = (2/π)·atan(k·x)`, or normalised `atan(k·x)/atan(k)` | Softer knee, slower-decaying harmonics than tanh |
| **cubic soft clip** | `y = 1.5x − 0.5x³` for \|x\| ≤ 1, else `sign(x)` | Zero cost, exactly 3rd-harmonic-only, `y'(±1) = 0` so C¹ at the clip point. [musicdsp #114](https://www.musicdsp.org/en/latest/Effects/114-waveshaper-simple-description.html): "a very mellow and musical-sounding distortion" |
| Taylor-tanh | `y = 1.5·(x − x³/3)` | First two Taylor terms of tanh (and of the triode law); normalised by 1/(1−1/3) |
| **sigmoid** | `y = 2/(1 + e^(−k·x)) − 1` | `f(0) = 0` ✓, odd. Needs the `−1` or it produces DC |
| **Bram de Jong soft saturation** | `f(x) = a + (x−a)/(1 + ((x−a)/(1−a))²)` for `a ≤ x ≤ 1`; `(a+1)/2` for `x > 1`; linear below `a` | [musicdsp #42](https://www.musicdsp.org/en/latest/Effects/42-soft-saturation.html). Linear below the threshold `a` — ideal when you want saturation only on peaks |

**Chebyshev — to dial in a *specific* harmonic spectrum.** `T_n(cos θ) = cos(nθ)`, so a unit-amplitude sine through `T_n` yields exactly the n-th harmonic:

```
T0 = 1,  T1 = x,  T2 = 2x²−1,  T3 = 4x³−3x,  T4 = 8x⁴−8x²+1,
T5 = 16x⁵−20x³+5x,   T_{n+1} = 2x·T_n − T_{n−1}
```
```js
function chebyshevCurve(n, weights /* {2:0.3, 3:0.15, 5:0.05} */) {
  const T = (k, x) => { if (k === 0) return 1; if (k === 1) return x;
    let a = 1, b = x; for (let i = 2; i <= k; i++) { const c = 2*x*b - a; a = b; b = c; } return b; };
  return makeCurve(n, x => {
    let y = x;
    for (const k in weights) y += weights[k] * T(+k, x);
    return Math.max(-1, Math.min(1, y));
  });
}
```
Even `n` ⇒ even harmonics (but injects DC since `T_even(0) ≠ 0`); odd `n` ⇒ odd harmonics. Caveat: amplitudes are exact only at full input amplitude — Chebyshev waveshaping is amplitude-dependent.

**Asymmetric (tape/tube-like) ⇒ even harmonics.** A symmetric `y(−x) = −y(x)` curve produces **only odd** harmonics. Break the symmetry for the 2nd and 4th that read as "warm":

```js
// (1) different drive per polarity — simplest, very effective
const asym = (kPos, kNeg) => x => x >= 0
  ? Math.tanh(kPos * x) / Math.tanh(kPos)
  : Math.tanh(kNeg * x) / Math.tanh(kNeg);

// (2) DC-bias trick: shift in, shape, shift back out — removes the DC pedestal
const biased = (k, bias = 0.18) => {
  const f = x => Math.tanh(k * x) / Math.tanh(k), off = f(bias);
  return x => f(x + bias) - off;                   // f(0) = 0 ⇒ no DC from the node
};
```

**The MDN / StackOverflow "distortion curve", decoded.** This appears in every Web Audio tutorial and is almost universally misunderstood:

```js
function makeDistortionCurve(amount = 50) {
  const k = amount, n_samples = 44100,
        curve = new Float32Array(n_samples), deg = Math.PI / 180;
  for (let i = 0; i < n_samples; i++) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
```
`20·deg = 20π/180 = **π/9** ≈ 0.349065`, so:

```
y(x)       = (3+k)·(π/9)·x / (π + k|x|)
slope at 0 = (3+k)/9
y(±1)      = ±(3+k)(π/9)/(π+k)  →  ±π/9 ≈ ±0.3491  as k→∞   (= −9.14 dB)
```
It is a **rational (hyperbolic) soft clipper** of the family `y = A·x/(B + k|x|)`. Measured:

| k | slope@0 | y(0.1) | y(0.5) | y(1) |
|---|---|---|---|---|
| 0 | 0.333 | 0.033 | 0.167 | **0.333** |
| 5 | 0.889 | 0.077 | 0.248 | 0.343 |
| **50** (MDN default) | **5.889** | 0.227 | 0.329 | **0.348** |
| 400 | 44.8 | 0.326 | 0.346 | 0.349 |

Takeaways: (i) **the output ceiling is ~0.349 regardless of `amount`** — it always costs ~9 dB and needs ~+9 dB makeup; (ii) at `k = 0` it is *linear* `y = x/3`, not a bypass; (iii) `amount` is effectively input drive, not distortion character; (iv) `n_samples = 44100` is wildly oversized — 2049 entries is already inaudibly accurate; (v) it is even-length, so there is no exact entry at x = 0. **Verdict: use normalised tanh instead.** It is cheaper to reason about and does not silently eat 9 dB.

**A tape stage** (remember: `WaveShaperNode` is **memoryless** — no hysteresis — so real tape needs a chain, not a curve):

```js
function tapeStage(ctx, { drive = 2.2, asymmetry = 0.12, hfLossHz = 7500, headBumpHz = 90 } = {}) {
  const pre = new GainNode(ctx, { gain: drive });
  const f = Math.tanh, off = f(asymmetry);
  const shaper = new WaveShaperNode(ctx, {
    curve: makeCurve(4097, x => (f(2.2 * x + asymmetry) - off) / (f(2.2 + asymmetry) - off)),
    oversample: '4x',
  });
  const bump    = new BiquadFilterNode(ctx, { type:'peaking',  frequency: headBumpHz, Q: 1.2, gain: +2 });
  const hfLoss  = new BiquadFilterNode(ctx, { type:'highshelf',frequency: hfLossHz,  gain: -3 });
  const gapLoss = new BiquadFilterNode(ctx, { type:'lowpass',  frequency: 15000, Q: -3.0103 });
  const dcBlock = new BiquadFilterNode(ctx, { type:'highpass', frequency: 18, Q: -3.0103 });
  const post = new GainNode(ctx, { gain: 1 / drive });
  pre.connect(shaper).connect(bump).connect(hfLoss).connect(gapLoss).connect(dcBlock).connect(post);
  return { input: pre, output: post };
}
```
`headBumpHz` 60 Hz at 15 ips / 110–120 Hz at 30 ips, `gapLoss` 15 kHz for cassette Type I (§2.12).

### 5.5 AudioWorklet — noise, bitcrush, wow & flutter

#### 5.5.1 AudioWorklet vs ScriptProcessorNode

`ScriptProcessorNode` is **deprecated**, runs on the **main thread**, and glitches under any layout or GC pressure. It is listed in the spec with "(deprecated)". **Do not use it.** `AudioWorkletProcessor.process()` runs on the audio rendering thread in **128-sample render quanta** (the ED now allows a variable render quantum via `renderSizeHint`/`renderQuantumSize`, but 128 is universal in practice).

Gotchas:
- Module loading is async and **per-context**: `await ctx.audioWorklet.addModule(url)`. An `OfflineAudioContext` needs its own `addModule()` call.
- The module URL is subject to CORS. **You cannot use `importScripts`**, and there is no DOM, no `window`, no `fetch` of relative paths.
- `parameterDescriptors` with `automationRate: 'a-rate' | 'k-rate'`. a-rate params arrive as a `Float32Array` of length 128; **k-rate params arrive as length 1** — so always branch on `p.x.length > 1 ? p.x[i] : p.x[0]`.
- Communication is via `port.postMessage`; for continuous data use a `SharedArrayBuffer` ring buffer, which requires **COOP/COEP headers** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
- `process()` must `return true` to stay alive while it has a tail; returning `false` lets the node be collected.
- **Denormals:** Blink wraps native processing in `DenormalDisabler`, but **your worklet JS has no such protection.** A decaying feedback tail can drive values into the denormal range and tank performance. Snap to zero below ~1e-20 in any feedback loop.

#### 5.5.2 Noise generation (for `ambience`)

**White:** `x = 2·Math.random() − 1`.

**Pink — Paul Kellett's filters** ([musicdsp #76](https://www.musicdsp.org/en/latest/Filters/76-pink-noise-filter.html)). The "refined" version is accurate to **±0.05 dB above 9.2 Hz**; the "economy" version to **±0.5 dB**:

```js
// REFINED (±0.05 dB above 9.2 Hz) — 7 state variables
b0 = 0.99886 * b0 + white * 0.0555179;
b1 = 0.99332 * b1 + white * 0.0750759;
b2 = 0.96900 * b2 + white * 0.1538520;
b3 = 0.86650 * b3 + white * 0.3104856;
b4 = 0.55000 * b4 + white * 0.5329522;
b5 = -0.7616 * b5 - white * 0.0168980;
pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
b6 = white * 0.115926;
pink *= 0.11;                           // scale to roughly ±1

// ECONOMY (±0.5 dB) — 3 state variables
b0 = 0.99765 * b0 + white * 0.0990460;
b1 = 0.96300 * b1 + white * 0.2965164;
b2 = 0.57000 * b2 + white * 1.0526913;
pink = b0 + b1 + b2 + white * 0.1848;
```
⚠ **These coefficients are tuned for 44.1 kHz.** At 96 kHz the curve tilts. For Dampen, either accept the tilt (it is small over 44.1–48 kHz) or correct with a compensating shelf.

**Brown — leaky integrator** ([noisehack](https://noisehack.com/generate-noise-web-audio-api/)):
```js
last = (last + 0.02 * white) / 1.02;
brown = last * 3.5;                     // scale to roughly ±1
```
This is a one-pole integrator giving the −6 dB/oct slope of §3.1. It has **no DC blocker**, so over long runs it wanders — add a 10–20 Hz highpass after it, or clamp `last`.

```js
// noise-processor.js — white / pink / brown in one worklet
class NoiseProc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'level', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' }];
  }
  constructor(o) {
    super();
    this.kind = (o.processorOptions && o.processorOptions.kind) || 'brown';
    this.b = new Float64Array(7);
    this.last = 0;
  }
  process(_i, outputs, p) {
    const out = outputs[0];
    for (let i = 0; i < out[0].length; i++) {
      const w = 2 * Math.random() - 1;
      let v;
      if (this.kind === 'white') v = w;
      else if (this.kind === 'pink') {
        const b = this.b;
        b[0] = 0.99886*b[0] + w*0.0555179;  b[1] = 0.99332*b[1] + w*0.0750759;
        b[2] = 0.96900*b[2] + w*0.1538520;  b[3] = 0.86650*b[3] + w*0.3104856;
        b[4] = 0.55000*b[4] + w*0.5329522;  b[5] = -0.7616*b[5] - w*0.0168980;
        v = (b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6] + w*0.5362) * 0.11;
        b[6] = w * 0.115926;
      } else {                                      // brown
        this.last = (this.last + 0.02 * w) / 1.02;
        v = this.last * 3.5;
      }
      const g = p.level.length > 1 ? p.level[i] : p.level[0];
      // independent noise per channel would be better for width; this is correlated (mono bed)
      for (let c = 0; c < out.length; c++) out[c][i] = v * g;
    }
    return true;
  }
}
registerProcessor('noise', NoiseProc);
```

**Shaping the bed to the §3.3 NRC target** (nearly flat below 400 Hz, ≈ −7 dB/oct above 1.6 kHz) — pink is too bright above 1.6 kHz and brown too dark below 400 Hz, so:
```js
// pink base + a high shelf = the NRC optimum masking contour
const bed   = new AudioWorkletNode(ctx, 'noise', { processorOptions: { kind: 'pink' } });
const shelf = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 1600, gain: -9 });
const roll  = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6300, Q: -3.0103 });
const lvl   = new GainNode(ctx, { gain: 0 });   // set from ambience.level
bed.connect(shelf).connect(roll).connect(lvl);
```
`ambience.tone` (0 = dark, 1 = bright) maps onto `shelf.gain` over roughly **−16 dB → 0 dB**.

**Vinyl crackle** (§2.12): periodic pop at `rpm/60` Hz (0.556 / 0.75 / 1.30 Hz) plus Poisson crackle at 8–25 events/s, each a 1–3-sample impulse highpassed above ~2 kHz:
```js
// inside process(), per sample
if (Math.random() < eventsPerSec / sampleRate) impulse = (2*Math.random()-1) * crackleAmp;
```

#### 5.5.3 Bitcrush

Two independent operations: **quantisation** (bit depth) and **decimation** (sample-and-hold). The spec itself carries a canonical `Bitcrusher` processor (§1.32.7):

```js
// bitcrush-processor.js
class Bitcrusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bitDepth',   defaultValue: 12, minValue: 1, maxValue: 16, automationRate: 'a-rate' },
      { name: 'frequencyReduction', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
    ];
  }
  constructor() { super(); this._phase = 0; this._lastSample = 0; }
  process(inputs, outputs, p) {
    const input = inputs[0], output = outputs[0];
    if (!input.length) return true;
    for (let c = 0; c < input.length; c++) {
      const x = input[c], y = output[c];
      for (let i = 0; i < x.length; i++) {
        const bits = p.bitDepth.length > 1 ? p.bitDepth[i] : p.bitDepth[0];
        const red  = p.frequencyReduction.length > 1 ? p.frequencyReduction[i] : p.frequencyReduction[0];
        const step = Math.pow(0.5, bits);
        this._phase += red;
        if (this._phase >= 1) { this._phase -= 1; this._lastSample = step * Math.floor(x[i] / step + 0.5); }
        y[i] = this._lastSample;
      }
    }
    return true;
  }
}
registerProcessor('bitcrusher', Bitcrusher);
```
`step = 0.5^bits` is mid-tread quantisation; `SQNR = 6.02·bits + 1.76 dB` (§2.13). `frequencyReduction = 1/downsample`, so `DampenParams.bitcrush.downsample = 2` ⇒ `frequencyReduction = 0.5` ⇒ effective rate `fs/2`.

**Two things the spec example omits and Dampen needs:**
1. **A post-decimation lowpass is not optional** (§2.13 — RC-20 calls it "Smooth"). Follow the crusher with a lowpass at roughly `0.45 · fs / downsample` to remove the sample-and-hold imaging.
2. **`bitcrush.mix`** needs a dry/wet pair around the node, because `process()` has no mix param.

#### 5.5.4 Wow & flutter

A modulated **fractional-delay line**. Linear interpolation is audible (it is a lowpass that varies with fractional position); use **cubic Hermite** or a polyphase windowed-sinc reader.

```js
// wowflutter-processor.js  (Hermite interpolation on a modulated delay line)
class WowFlutter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name:'wowRate',      defaultValue:0.556, minValue:0, maxValue:10,  automationRate:'k-rate' },
      { name:'wowDepth',     defaultValue:0,     minValue:0, maxValue:1,   automationRate:'k-rate' },
      { name:'flutterRate',  defaultValue:8,     minValue:0, maxValue:40,  automationRate:'k-rate' },
      { name:'flutterDepth', defaultValue:0,     minValue:0, maxValue:1,   automationRate:'k-rate' },
    ];
  }
  constructor() {
    super();
    this.N = 1 << 14;                                  // ~341 ms at 48 kHz
    this.buf = [new Float32Array(this.N), new Float32Array(this.N)];
    this.w = 0; this.pw = 0; this.pf = 0;
    this.base = Math.round(0.010 * sampleRate);        // 10 ms nominal delay
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const n = out[0].length, N = this.N;
    // 1% speed deviation ≈ 17 cents (§2.12). Map depth 0..1 → 0..1.5% deviation.
    const wowAmp = p.wowDepth[0] * 0.015 * this.base;
    const fltAmp = p.flutterDepth[0] * 0.004 * this.base;
    const dpw = 2 * Math.PI * p.wowRate[0] / sampleRate;
    const dpf = 2 * Math.PI * p.flutterRate[0] / sampleRate;

    for (let i = 0; i < n; i++) {
      this.pw += dpw; this.pf += dpf;
      const d = this.base + wowAmp * Math.sin(this.pw) + fltAmp * Math.sin(this.pf);
      for (let c = 0; c < out.length; c++) {
        const b = this.buf[c] || this.buf[0];
        b[this.w] = inp[c] ? inp[c][i] : 0;
        const rp = this.w - d;
        const i0 = Math.floor(rp), frac = rp - i0;
        const m1 = b[((i0 - 1) % N + N) % N], p0 = b[((i0) % N + N) % N];
        const p1 = b[((i0 + 1) % N + N) % N], p2 = b[((i0 + 2) % N + N) % N];
        // 4-point cubic Hermite (Catmull-Rom): reproduces a straight line exactly
        const c0 = p0;
        const c1 = 0.5 * (p1 - m1);
        const c2 = m1 - 2.5 * p0 + 2 * p1 - 0.5 * p2;
        const c3 = 0.5 * (p2 - m1) + 1.5 * (p0 - p1);
        out[c][i] = ((c3 * frac + c2) * frac + c1) * frac + c0;
      }
      this.w = (this.w + 1) % N;
    }
    return true;
  }
}
registerProcessor('wowflutter', WowFlutter);
```
Reference values from §2.12: vinyl wow fundamental **0.556 Hz** (33⅓ rpm), flutter above **6 Hz**, and an *audible* effect needs **0.3–1.5 % depth — 10–20× real-machine spec** (0.08 % cassette, < 0.05 % WRMS turntable, audibility threshold < 0.1 % WRMS).

> **⚠ Why this cannot be a native `DelayNode`:** "If DelayNode is part of a cycle, then the value of the `delayTime` attribute is **clamped to a minimum of one render quantum**" (2.67 ms at 48 kHz). It is not in a cycle here, so a `DelayNode` with an LFO on `delayTime` *does* work for wow — but the engine's interpolation is unspecified, so quality varies by browser. The worklet gives you Hermite everywhere. `createDelay(maxDelayTime)` also requires `0 < maxDelayTime < 180 s`, **fixed at construction** — size it generously.

### 5.6 Stereo width: Mid/Side matrix math

#### 5.6.1 The math

```
Encode:   M = (L + R) / 2
          S = (L − R) / 2

Decode:   L' = M + w·S
          R' = M − w·S

w = 0  → L' = R' = M            (mono)
w = 1  → L' = L,  R' = R        (identity)
w = 2  → double-wide
```
Energy-preserving variants use `1/√2` instead of `1/2` in the encode. For `DampenParams.width` (documented 0 = mono, 1 = original, 2 = double-wide) the `1/2` form above is exactly right. To hold perceived loudness roughly constant as `w` varies, normalise by `1/√((1 + w²)/2)`.

#### 5.6.2 Building it

**`GainNode.gain` accepts negative values** — spec §1.20.2: `defaultValue 1`, `minValue` most-negative-single-float (≈ −3.4028235e38), `maxValue` most-positive-single-float, `automationRate "a-rate"`. So `gain = −1` is a legitimate polarity inversion, which is how you get the subtraction.

```js
function makeStereoWidth(ctx, width = 1) {
  // ⚠ force a real 2-channel signal first — see gotchas below
  const input = new GainNode(ctx, {
    gain: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
  });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merge = new ChannelMergerNode(ctx,  { numberOfInputs: 2 });

  // encode
  const mL = new GainNode(ctx, { gain:  0.5 });   // M = 0.5L + 0.5R
  const mR = new GainNode(ctx, { gain:  0.5 });
  const sL = new GainNode(ctx, { gain:  0.5 });   // S = 0.5L − 0.5R
  const sR = new GainNode(ctx, { gain: -0.5 });   // ← negative gain = inversion

  const mid  = new GainNode(ctx, { gain: 1 });
  const side = new GainNode(ctx, { gain: width });  // ← the width control
  // optional: lowpass the SIDE only — distant sources have no HF side energy
  const sideLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: -3.0103 });

  // decode
  const outL  = new GainNode(ctx, { gain:  1 });  // L' = M + wS
  const outRm = new GainNode(ctx, { gain:  1 });
  const outRs = new GainNode(ctx, { gain: -1 });  // R' = M − wS

  input.connect(split);
  split.connect(mL, 0); split.connect(mR, 1);
  split.connect(sL, 0); split.connect(sR, 1);
  mL.connect(mid);  mR.connect(mid);
  sL.connect(sideLp); sR.connect(sideLp); sideLp.connect(side);

  mid.connect(outL);   side.connect(outL);        // summing at an input = addition
  mid.connect(outRm);  side.connect(outRs);
  outL.connect(merge, 0, 0);
  outRm.connect(merge, 0, 1);
  outRs.connect(merge, 0, 1);                     // both land on merger input 1 → summed

  return {
    input, output: merge, sideGain: side.gain, sideLp,
    setWidth(w, t, tau = 0.03) { side.gain.setTargetAtTime(w, t, tau); },
  };
}
```

> **The cheapest realism win in the whole chain:** narrow the width **and** lowpass only the side signal. A distant or next-room source is nearly mono and has essentially no HF side energy. Set `sideLp.frequency` to 1–2 kHz and `width ≈ 0.2–0.35`.

#### 5.6.3 StereoPannerNode — the exact pan law, and why it cannot do width

Spec §6.3.3, "the following algorithm **MUST** be implemented", per sample:

```js
pan = max(-1, min(1, pan));
// mono input:                 x = (pan + 1) / 2;
// stereo input:               x = (pan <= 0) ? pan + 1 : pan;
gainL = cos(x * Math.PI / 2);
gainR = sin(x * Math.PI / 2);

// mono input:
outputL = input * gainL;   outputR = input * gainR;

// stereo input:
if (pan <= 0) { outputL = inputL + inputR * gainL;  outputR = inputR * gainR; }
else          { outputL = inputL * gainL;           outputR = inputR + inputL * gainR; }
```
`cos² + sin² = 1` ⇒ constant power, **−3.01 dB per channel at centre**.

**Why it cannot do width:** for stereo input the matrix is **triangular, not symmetric** — it only ever *folds one channel into the other*. It can collapse toward one side, never push L and R apart, and it has no path that subtracts. The spec says so in §1.30.4:

> "Because its processing is constrained by the above definitions, StereoPannerNode is limited to mixing **no more than 2 channels** of audio, and producing **exactly 2 channels**. It is possible to use a ChannelSplitterNode, intermediate processing by a subgraph of GainNodes and/or other nodes, and recombination via a ChannelMergerNode to realize **arbitrary approaches to panning and mixing**."

`pan`: default 0, min −1, max 1, **a-rate**. `channelCount 2` constrained, `channelCountMode "clamped-max"` constrained, output "hard-coded to stereo and cannot be configured", tail-time no.

#### 5.6.4 Mono collapse — and the spec's downmix matrices

**The normative speaker-layout downmix equations** (§4.5):
```
Mono down-mix:
  2 → 1 : output = 0.5 * (input.L + input.R)
  4 → 1 : output = 0.25 * (input.L + input.R + input.SL + input.SR)
  5.1 → 1: output = sqrt(0.5) * (input.L + input.R) + input.C + 0.5 * (input.SL + input.SR)
Stereo down-mix:
  4 → 2 : output.L = 0.5 * (input.L + input.SL);  output.R = 0.5 * (input.R + input.SR)
  5.1 → 2: output.L = L + sqrt(0.5) * (input.C + input.SL)
           output.R = R + sqrt(0.5) * (input.C + input.SR)
```
Up-mix (§4.4):
```
1 → 2 : output.L = input;  output.R = input
2 → 4 : L = L; R = R; SL = SR = 0
1 → 5.1: L = R = 0; C = input; LFE = 0; SL = SR = 0      ← mono goes to CENTRE
```

**Method 1 — exploit `channelCount`/`channelCountMode`/`channelInterpretation`.** This is the spec's own idiom (§4.6, verbatim: *"Explicitly down-mix to mono"*):

```js
function monoCollapse(ctx) {
  const down = new GainNode(ctx, { gain: 1, channelCount: 1,
    channelCountMode: 'explicit', channelInterpretation: 'speakers' });   // 0.5*(L+R)
  const up   = new GainNode(ctx, { gain: 1, channelCount: 2,
    channelCountMode: 'explicit', channelInterpretation: 'speakers' });   // L = R = mono
  down.connect(up);
  return { input: down, output: up };
}
```
Two GainNodes, exact spec semantics, zero JS, done in the engine. How the attributes interact (§4): the engine computes `computedNumberOfChannels` per input, up- or down-mixes each connection to it "**according to the ChannelInterpretation value**", then sums. `"max"` ⇒ computed = max over connections; `"clamped-max"` ⇒ clamped to `channelCount`; `"explicit"` ⇒ exactly `channelCount`. **`channelInterpretation: "discrete"` just truncates or zero-pads** — no 0.5 factors, no duplication.

**Method 2 — splitter → 0.5 gain → merger (both inputs):**
```js
const sp = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
const g  = new GainNode(ctx, { gain: 0.5 });
const mg = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
sp.connect(g, 0); sp.connect(g, 1);         // both channels sum into g → 0.5*(L+R)
g.connect(mg, 0, 0); g.connect(mg, 0, 1);   // same mono to both outputs
```

**Method 3 — the M/S graph with `width = 0`** (§5.6.2). Use this, since Dampen already has a continuous `width` control.

**Mono-bass ("elliptical EQ")** — the idiomatic distant-source move, collapsing only the low end:
```js
const lo = butterworth(ctx, 'lowpass',  140, 2);
const hi = butterworth(ctx, 'highpass', 140, 2);
src.connect(lo.input); lo.output.connect(monoCollapse(ctx).input /* … → out */);
src.connect(hi.input); hi.output.connect(/* stereo path → out */);
```

#### 5.6.5 Channel-routing gotchas that will bite

- **`ChannelMergerNode` has `channelCount 1`, `channelCountMode "explicit"`.** Spec: "To merge multiple inputs into one stream, **each input gets downmixed into one channel (mono)**." Connect a *stereo* node to a merger input and you silently get `0.5*(L+R)` on that one output channel. **Always feed mergers from splitter outputs or mono nodes.**
- **The default merger has 6 inputs**, and unconnected ones "still count as one silent channel in the output" — so you would emit a 6-channel stream. Always pass `{ numberOfInputs: 2 }`.
- **`ChannelSplitterNode` is `channelInterpretation: "discrete"`** (constrained), `channelCount = numberOfOutputs`, `channelCountMode "explicit"` (both constrained). Therefore **a mono source into a splitter(2) gives `output0 = mono`, `output1 = silence`** — the discrete up-mix zero-pads, it does *not* duplicate. Your M/S then computes `M = 0.5·L`, `S = 0.5·L`, and width does something wrong. **Fix: put a `GainNode { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' }` in front**, as `makeStereoWidth`'s `input` does. **This matters for Dampen specifically** because a `DampenSource` of kind `'buffer'` may well be mono.
- **Connecting two outputs to the same input sums them.** That is the mechanism §5.6.2 relies on.
- **Tail-time interacts with channel-count changes** (§4.3): for `DelayNode` and `DynamicsCompressorNode` the output channel count increases only "when the input that was received with greater channel count begins to affect the output". And: "For a ConvolverNode, this only applies to the case where the impulse response is mono. **Otherwise, the ConvolverNode always outputs a stereo signal** regardless of its input channel count."
- **Channel order is normative** (§4.2): index 0 = `SPEAKER_FRONT_LEFT`, 1 = `SPEAKER_FRONT_RIGHT`; for 5.1: 2 = C, 3 = LFE, 4 = BL, 5 = BR.

### 5.7 Smooth parameter ramps without zipper noise

#### 5.7.1 The methods and their exact value formulas (spec §1.6.2)

| Method | Value on `T₀ ≤ t < T₁` |
|---|---|
| `setValueAtTime(V, T₀)` | `v(t) = V` (step; constant until the next event) |
| `linearRampToValueAtTime(V₁, T₁)` | `v(t) = V₀ + (V₁ − V₀)·(t − T₀)/(T₁ − T₀)` |
| `exponentialRampToValueAtTime(V₁, T₁)` | `v(t) = V₀·(V₁/V₀)^((t − T₀)/(T₁ − T₀))` |
| `setTargetAtTime(V₁, T₀, τ)` | **`v(t) = V₁ + (V₀ − V₁)·e^(−(t − T₀)/τ)`** |
| `setValueCurveAtTime(V[], T₀, T_D)` | linear interpolation between `V[k]`, `V[k+1]`, `k = ⌊((N−1)/T_D)·(t − T₀)⌋` |

**All ramps start from "the value at the time `T₀`" where `T₀` is the time of the *previous event*** — not "now". This is the most common source of surprise: a `linearRampToValueAtTime` with no preceding event behaves "as if `setValueAtTime(value, currentTime)` were called", so a ramp scheduled far in the future ramps *from now*, over the whole interval. **Always anchor with `setValueAtTime(param.value, t)` first.**

> "Automation event times are **not quantized** with respect to the prevailing sample rate. Formulas… are applied to the **exact numerical times** given when scheduling events."

#### 5.7.2 `exponentialRampToValueAtTime` cannot reach or cross zero

> "A `RangeError` exception MUST be thrown if this value is equal to **0**."
> "If V₀ and V₁ have **opposite signs** or if **V₀ is zero**, then `v(t) = V₀` for `T₀ ≤ t < T₁`." — i.e. it silently becomes a **hold**, no ramp, **no error**.
> "This also implies an exponential ramp to 0 is not possible. A good approximation can be achieved using `setTargetAtTime()`."

For fade-outs: ramp to an epsilon (`1e-4` ≈ −80 dB) then `setValueAtTime(0, …)`, or use `setTargetAtTime`. The best pattern in the wild is Tone.js's:

```ts
// Tone/core/context/Param.ts — setTarget, then land exactly
exponentialApproachValueAtTime(value, time, rampTime) {
  time = this.toSeconds(time); rampTime = this.toSeconds(rampTime);
  const timeConstant = Math.log(rampTime + 1) / Math.log(200);
  this.setTargetAtTime(value, time, timeConstant);
  this.cancelAndHoldAtTime(time + rampTime * 0.9);      // at 90%, switch to linear
  this.linearRampToValueAtTime(value, time + rampTime); // land exactly on target
  return this;
}
```

#### 5.7.3 `setTargetAtTime` — the glide, and its time constants

> "The time-constant value of **first-order filter (exponential) approach** to the target value… **If timeConstant is zero, the output value jumps immediately to the final value.** More precisely, timeConstant is the time it takes a first-order linear continuous time-invariant system to reach the value **1 − 1/e (around 63.2%)** given a step input."

| Elapsed | Reached | Residual |
|---|---|---|
| 1 τ | 63.2 % | −8.7 dB |
| 2 τ | 86.5 % | −17.4 dB |
| **3 τ** | **95.0 %** | −26.1 dB |
| 4 τ | 98.17 % | −34.7 dB |
| **5 τ** | **99.33 %** | −43.4 dB |
| 6.91 τ | 99.9 % | **−60 dB** |

So "3τ ≈ 95 %, 5τ ≈ 99.3 %" — and for exact −60 dB, **`τ = T/ln(1000) = T/6.907755`**, the same constant as the RT60 derivation in §5.2.3. That is why `setTargetAtTime(0, t, rt60/6.907755)` produces an exact RT60 envelope.

| Use | τ |
|---|---|
| **Click-free gain change, mute/unmute** | **0.005 – 0.02 s** |
| Musical fade / duck a bed | 0.05 – 0.15 s |
| **Filter sweep (muffle open/close)** | **0.05 – 0.15 s** |
| Slow morph between presets | 0.3 – 1.0 s |

⚠ `setTargetAtTime` **never actually reaches the target** and **never ends on its own**: "For all other events, the SetTarget event **ends at the time of the next event**." Leaving `setTargetAtTime(0, …)` on a gain means the gain is a tiny non-zero number forever — denormal risk, and the node never becomes silent for tail-time purposes. If you need exact 0, follow with `setValueAtTime(0, t + 5τ)`.

#### 5.7.4 `.value` is an automation event — this is the zipper-noise bug

> "Setting this attribute has the effect of assigning the requested value to the `[[current value]]` slot, **and calling the `setValueAtTime()` method with the current AudioContext's `currentTime` and `[[current value]]`**."

Three consequences:

1. `param.value = x` is a **step at `currentTime`** ⇒ a discontinuity ⇒ **click**. Driven from a slider's `input` event, that is the classic zipper noise. **Never do this for `gain` or `frequency`.**
2. It **inserts an event into the timeline**, so mixing `.value` with scheduled automation is order-dependent and will fight your ramps. Pick one discipline per param.
3. Reading `.value` returns `[[current value]]`, which is "the value of `paramIntrinsicValue` at the **beginning of this render quantum**" — up to 128 frames stale — and it **does not include connected AudioNode inputs** (`paramComputedValue = paramIntrinsicValue + input buffer`).

```js
// The correct slider handler for every Dampen control:
const SMOOTH = 0.02;
slider.addEventListener('input', () => {
  node.gain.setTargetAtTime(Number(slider.value), ctx.currentTime, SMOOTH);  // never .value =
});
```

#### 5.7.5 `cancelScheduledValues` vs `cancelAndHoldAtTime`

`cancelScheduledValues(t)`:
> "Cancels all scheduled parameter changes with times **greater than or equal to** cancelTime… **Any active automations whose automation event time is less than cancelTime are also cancelled, and such cancellations may cause discontinuities because the original value (from before such automation) is restored immediately.**"

That "restored immediately" is a **click generator** — cancelling mid-ramp snaps the param back to its pre-ramp value. **`cancelAndHoldAtTime(t)` is what you almost always want:**

> "the automation value that would have happened at cancelTime is then **propagated for all future time** until other automation events are introduced."

Its algorithm, summarised: if the next event after `t_c` is a linear or exponential ramp, it is rewritten as the same kind of ramp **ending at `t_c`** with the value the original would have had there; else if the preceding event is a `setTarget`, an implicit `setValueAtTime` is inserted at `t_c`; else if a `setValueCurve` is still running it is replaced with one of duration `t_c − t₃`, with the explicit requirement that it "MUST take care to produce the **same output as the original**, and not one computed using a different duration." Then all events after `t_c` are removed.

```js
// Canonical "retarget an in-flight ramp" idiom — use this for every preset change
function retarget(param, value, t, dur) {
  param.cancelAndHoldAtTime(t);          // freeze where we are, no click
  param.setValueAtTime(param.value, t);  // anchor (belt and braces)
  param.linearRampToValueAtTime(value, t + dur);
}
```

#### 5.7.6 `setValueCurveAtTime` scheduling rules

> "If `setValueCurveAtTime()` is called for time T and duration D and there are any events having a time **strictly greater than T, but strictly less than T + D**, then a `NotSupportedError` exception MUST be thrown… Similarly a `NotSupportedError` MUST be thrown if **any automation method is called at a time which is contained in `[T, T+D)`**."

Also: `InvalidStateError` if `values.length < 2`; `RangeError` if `duration` is not strictly positive and finite; "An **implicit call to `setValueAtTime()` is made at time T₀ + T_D with value V[N−1]**"; the array is copied.

#### 5.7.7 a-rate vs k-rate

> "For each render quantum, the value of a **k-rate** parameter MUST be sampled at the time of the **very first sample-frame**, and that value MUST be used for the **entire block**. **a-rate** parameters MUST be sampled for **each sample-frame**."

| Node | Params | Default rate | Changeable? |
|---|---|---|---|
| **BiquadFilterNode** | `frequency`, `detune`, `Q`, `gain` | **a-rate** (all four) | yes |
| **GainNode** | `gain` | **a-rate** | yes |
| **DelayNode** | `delayTime` | **a-rate** | yes |
| **StereoPannerNode** | `pan` | **a-rate** | yes |
| **AudioWorkletNode** | per descriptor | **a-rate** default | yes |
| **DynamicsCompressorNode** | all six | **k-rate** | **NO** — `InvalidStateError` |
| **AudioBufferSourceNode** | `playbackRate`, `detune` | **k-rate** | **NO** — `InvalidStateError` |
| **PannerNode** / `AudioListener` | all | a-rate | **ignored if `panningModel === 'HRTF'`** |

Setting an a-rate param to `'k-rate'` is a cheap CPU win for params you only step occasionally — but it reintroduces per-block quantisation, so never on anything you ramp audibly.

#### 5.7.8 Ramp filter cutoff in **log**-frequency

Spec, on `exponentialRampToValueAtTime`: "Parameters representing **filter frequencies** and playback rate are **best changed exponentially** because of the way humans perceive sound."

A linear ramp in Hz from 200 → 8000 Hz spends ~95 % of its time above 1 kHz: it sounds like nothing happens, then everything happens at once. `v(t) = V₀(V₁/V₀)^((t−T₀)/(T₁−T₀))` is exactly linear in `log(f)` — **constant octaves per second**.

```js
// Correct muffle open/close
function sweepCutoff(sections, fromHz, toHz, t0, dur) {
  for (const f of sections) {
    f.frequency.cancelAndHoldAtTime(t0);
    f.frequency.setValueAtTime(Math.max(20, fromHz), t0);   // never 0
    f.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), t0 + dur);
  }
}
```
`setTargetAtTime` is exponential **in the parameter value**, i.e. a linear-in-Hz approach — slightly "wrong" perceptually but so smooth it does not matter for moves of ≤ 2 octaves. **For Dampen's `amount` macro, which can sweep 18 kHz → 500 Hz (5 octaves), use `exponentialRampToValueAtTime`.**

Also: `frequency`'s min is 0 and exponential ramps cannot touch 0, so clamp the low end to ~20 Hz. And note:
> "When automation methods are used, **clamping is still applied. However, the automation is run as if there were no clamping at all.** Only when the automation values are to be applied to the output is the clamping done."

**For `drift`**, the cleanest implementation is an audio-rate modulation path with no timeline bookkeeping at all — `paramComputedValue = paramIntrinsicValue + (sum of connected AudioNode outputs)`:

```js
// drift: slow gain breathing. depth is in dB (§1.6: keep ≤ 2 dB, rate well under 0.5 Hz)
const lfo     = new OscillatorNode(ctx, { frequency: params.drift.rate, type: 'sine' });
const lfoGain = new GainNode(ctx, { gain: 0 });     // set below
lfo.connect(lfoGain).connect(outputGain.gain);      // adds to the intrinsic value
// linear-domain depth for ±d dB around unity:
const d = params.drift.depth;                       // dB
lfoGain.gain.value = (Math.pow(10, d / 20) - Math.pow(10, -d / 20)) / 2;
lfo.start();
```
"If the sum is NaN, replace the sum with the `defaultValue`."

### 5.8 Metering: AnalyserNode and LUFS in Web Audio

**AnalyserNode** (§1.8) — "The audio stream will be passed un-processed from input to output", `channelCount 2`, `channelCountMode "max"`, tail-time no. **It downmixes to mono for analysis.** `fftSize` power of two; `frequencyBinCount = fftSize/2`; `minDecibels`/`maxDecibels` default −100/−30; `smoothingTimeConstant` default **0.8**.

The exact pipeline (normative):
```
1. Compute the current time-domain data.
2. Apply a Blackman window:
     α = 0.16;  a₀ = (1−α)/2;  a₁ = 1/2;  a₂ = α/2
     w[n] = a₀ − a₁·cos(2πn/N) + a₂·cos(4πn/N),  n = 0..N−1
     x̂[n] = x[n]·w[n]
3. X[k] = (1/N)·Σ x̂[n]·W_N^(−kn),  W_N = e^(2πi/N),  k = 0..N/2−1
4. Smooth:  X̂[k] = τ·X̂₋₁[k] + (1 − τ)·|X[k]|      (NaN/±Inf → 0)
5. Y[k] = 20·log₁₀ X̂[k]
```

**For `EngineMeters`, do not use `getFloatFrequencyData`.** Use `getFloatTimeDomainData` and compute peak/RMS yourself, or better, a worklet so you see every sample. The spec's own VU-meter pattern (§1.32.7.2):

```js
const SMOOTHING_FACTOR = 0.9, MINIMUM_VALUE = 0.00001;
registerProcessor('vumeter', class extends AudioWorkletProcessor {
  constructor(o) { super(); this._volume = 0;
    this._ms = o.processorOptions.updateIntervalInMS; this._next = this._ms; }
  get intervalInFrames() { return this._ms / 1000 * sampleRate; }
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const s = input[0]; let sum = 0;
      for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
      this._volume = Math.max(Math.sqrt(sum / s.length), this._volume * SMOOTHING_FACTOR);
      this._next -= s.length;
      if (this._next < 0) { this._next += this.intervalInFrames;
        this.port.postMessage({ volume: this._volume }); }
    }
    return this._volume >= MINIMUM_VALUE;
  }
});
```

**LUFS / BS.1770 K-weighting.** Two biquads. **The published coefficients are 48 kHz only** — verbatim from Rec. ITU-R BS.1770-5, Tables 1 and 2:

```
Stage 1 (shelving, "spherical head"), Fs = 48 kHz:
  b0 =  1.53512485958697     a0 =  1 (implied)
  b1 = -2.69169618940638     a1 = -1.69065929318241
  b2 =  1.19839281085285     a2 =  0.73248077421585

Stage 2 (RLB high-pass), Fs = 48 kHz:
  b0 =  1.0   b1 = -2.0   b2 = 1.0
  a1 = -1.99004745483398     a2 =  0.99007225036621
```
> "These filter coefficients are for a sampling rate of 48 kHz. Implementations at other sampling rates will require different coefficient values, which should be chosen to provide the same frequency response that the specified filter provides at 48 kHz."

The accepted reconstruction for other rates is Brecht De Man's parametric design ([loudness.py](https://github.com/BrechtDeMan/loudness.py), shipped in [pyloudnorm](https://github.com/csteinmetz1/pyloudnorm)'s `iirfilter.py`). **Verified to reproduce the official 48 kHz table to 14 significant figures:**

```js
const KW = {
  shelf: { G: 3.999843853973347, Q: 0.7071752369554196, fc: 1681.974450955533 },
  hp:    {                       Q: 0.5003270373238773, fc:   38.13547087602444 },
};
function kWeightingCoeffs(fs) {
  let { G, Q, fc } = KW.shelf;
  let K = Math.tan(Math.PI * fc / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.499666774155);          // ← the magic exponent
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + Vb*K/Q + K*K)/a0, 2*(K*K - Vh)/a0, (Vh - Vb*K/Q + K*K)/a0],
    a: [1, 2*(K*K - 1)/a0, (1 - K/Q + K*K)/a0],
  };
  ({ Q, fc } = KW.hp);
  K = Math.tan(Math.PI * fc / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [1, 2*(K*K - 1)/a0, (1 - K/Q + K*K)/a0] };
  return { shelf, hp };
}
// Coefficients are FIXED ⇒ IIRFilterNode is exactly right here (§5.1.7)
function kWeightingChain(ctx) {
  const { shelf, hp } = kWeightingCoeffs(ctx.sampleRate);
  const s = new IIRFilterNode(ctx, { feedforward: shelf.b, feedback: shelf.a });
  const h = new IIRFilterNode(ctx, { feedforward: hp.b,    feedback: hp.a   });
  s.connect(h);
  return { input: s, output: h };
}
```

Reference outputs from that check:

| Fs | stage | b | a |
|---|---|---|---|
| 48000 | shelf | 1.535124859587006, −2.691696189406381, 1.198392810852815 | 1, −1.690659293182410, 0.732480774215850 |
| 48000 | hp | 1, −2, 1 | 1, −1.990047454833980, 0.990072250366210 |
| **44100** | shelf | 1.530841230050386, −2.650979995154730, 1.169079079921549 | 1, −1.663655113256020, 0.712595428073225 |
| **44100** | hp | 1, −2, 1 | 1, −1.989169673629796, 0.989199035787039 |

Then accumulate mean square per block in a worklet and apply the §4.1 gating. Calibration check: a 0 dBFS 997 Hz sine into one channel must read **−3.01 LKFS**.

### 5.9 Other practical gotchas

**Autoplay policy.** Spec §1.2.1: "An AudioContext is said to be **allowed to start** if the user agent allows the context state to transition from 'suspended' to 'running'. A user agent **may disallow this initial transition**, and to allow it only when the AudioContext's relevant global object has **sticky activation**." Chrome's error: *"The AudioContext was not allowed to start. It must be resume (or created) after a user gesture on the page."* ([Chrome blog](https://developer.chrome.com/blog/autoplay))

```js
let ctx;
const getCtx = () => (ctx ??= new AudioContext({ latencyHint: 'playback' }));
async function unlock() { const c = getCtx(); if (c.state !== 'running') await c.resume(); }
for (const ev of ['pointerdown', 'keydown', 'touchend'])
  document.addEventListener(ev, unlock, { once: true, capture: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx?.state === 'suspended') ctx.resume();
});
```
Constructing the context without a gesture is fine (you get `state === 'suspended'`). **`currentTime` does not advance while suspended — never schedule relative to `ctx.currentTime` before the context is running.** This maps onto `EngineStatus`: `'suspended'` is a first-class state, not an error.

**`latencyHint`.** `'interactive'` (default, lowest latency), `'balanced'`, `'playback'`, or a number in seconds. "The **actual latency used is given by AudioContext's `baseLatency`**." **For Dampen use `'playback'`** — nobody is playing this interactively, and bigger device buffers mean far fewer dropouts and much less battery and CPU. `ctx.baseLatency` is the graph→device buffer; `ctx.outputLatency` the end-to-end estimate. The ED also exposes `ctx.audioPlaybackStats` (`underrunEvents`, `underrunDuration`, `totalDuration`, `average/minimum/maximumLatency`, "update only once per second") — **the right way to measure whether the chain is too heavy on a device instead of guessing.** Feature-detect it.

**Sample rate (44.1 vs 48 kHz) matters more than expected.**
- IRs **must** match `ctx.sampleRate` or `ConvolverNode.buffer` throws. Never hard-code 44100.
- Convolver normalisation shifts by `44100/fs` ⇒ **−0.73 dB at 48 kHz** for the same IR (§5.2.2).
- **Kellett pink coefficients are tuned for 44.1 kHz** (§5.5.2).
- **K-weighting coefficients are published for 48 kHz only** (§5.8).
- Bilinear-transform frequency warping means a filter at 15 kHz measures slightly differently at 44.1 vs 48 kHz. Nothing to do, just don't be surprised.
- Supported range: "Implementations MUST support sample rates between **3000 Hz and 768000 Hz**." You *can* force `new AudioContext({ sampleRate: 48000 })`, but on hardware that doesn't run natively at it the browser inserts a resampler (latency + CPU). **Prefer adapting to `ctx.sampleRate`.**

**`OfflineAudioContext` for pre-rendering.** The right tool for IRs, curve tables and noise beds. Runs as fast as the CPU allows, needs no user gesture. Gotchas: `currentTime` starts at 0 and advances per quantum, so schedule from 0, not `oc.currentTime`; `suspend(time)` is "quantized and rounded up to the render quantum size"; and **`AudioWorkletNode`s need `oc.audioWorklet.addModule()` on the offline context too** — modules are per-context.

**Node count, CPU, GC.** No spec limit; thousands of cheap nodes is fine, thousands of expensive ones is not. Per [padenot's cost table](https://padenot.github.io/web-audio-perf/): biquads "relatively cheap (five multiplication and four additions per sample)"; `DynamicsCompressorNode` "not too expensive"; `WaveShaperNode` without oversampling is "linear interpolation, which is a cheap process"; `ConvolverNode` "very expensive"; `PannerNode` with HRTF "**Very** expensive". Nodes with tail-time (`Biquad`, `IIR`, `Convolver`, `Delay`, `DynamicsCompressor`, oversampled `WaveShaper`) keep rendering after input stops; a node is collectible only once disconnected, unreachable, and out of tail. A `WaveShaperNode` whose curve has `f(0) ≠ 0` "will cause this node to produce a **DC signal even if there are no inputs connected**… until the node is disconnected from downstream nodes." Close worklet `MessagePort`s on teardown. **Build the graph once and automate it; never rebuild per frame.**

**`AudioBufferSourceNode.start()` "may not be issued multiple times"** — one-shot nodes. Create a new one per playback and use `ended` to disconnect. Relevant to `DampenSource` of kind `'buffer'` with `loop`.

**There is no built-in limiter.** Confirmed by exhaustion of the node list. `DynamicsCompressorNode` caps at `ratio: 20` (§5.3.4). Options are exactly: a `WaveShaperNode` soft-clip with `oversample: '4x'`, or an AudioWorklet true-peak limiter with look-ahead. And remember: "The range of all audio signals at a destination node of any audio graph is nominally [−1, 1]. The audio rendition of signal values **outside this range**, or of the values NaN, positive infinity or negative infinity, **is undefined by this specification**." **Put a soft-clip last, always** — §4.1 sets the ceiling at −1.5 dBTP.

**Misc.** `createDelay(maxDelayTime)`: "greater than zero and **less than three minutes**", default 1 s, **fixed at construction**. `DelayNode` in a cycle has `delayTime` "clamped to a minimum of one render quantum" (2.67 ms at 48 kHz) — so native nodes cannot build a short comb; use a worklet. **Spec-only features absent from shipping engines:** `DynamicsCompressorNode.makeupGain`, `renderSizeHint`/`renderQuantumSize`, `AudioPlaybackStats`, `AudioContextOptions.sinkId`. **Feature-detect, don't assume.**

### 5.10 The five things most likely to silently break this chain

1. **`BiquadFilterNode.Q` is in dB for `lowpass`/`highpass`.** Butterworth is `Q.value = −3.0103`, not `0.7071`. The default `1` is a +2 dB resonant peak. Confirmed in Blink, Gecko and WebKit source. **Convert `DampenParams.lowpass.q` with `20·log10(q)`.**
2. **`ConvolverNode.buffer` must be at `ctx.sampleRate`** (else `NotSupportedError`), is **RMS-normalised by default** (so changing `reverb.decay` changes loudness, and 48 kHz is 0.73 dB quieter than 44.1), and setting it **blocks the main thread** for ~35 ms per second of IR in Chrome.
3. **`ChannelMergerNode` inputs are `channelCount: 1, "explicit"`** and **`ChannelSplitterNode` is `"discrete"`** — a stereo→merger connection silently monos, and a mono→splitter connection silently leaves channel 1 silent. Force 2 channels with a `GainNode { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' }` at the head of the M/S graph.
4. **`param.value = x` is `setValueAtTime(x, currentTime)`** — a step, a click, and a timeline event that fights your ramps. Use `setTargetAtTime(x, t, 0.02)`.
5. **`DynamicsCompressorNode` has a fixed 6 ms look-ahead, a mandatory uncontrollable `(1/curve(1))^0.6` makeup gain, a hard-linked peak detector, an adaptive release you cannot disable, and `ratio ≤ 20`.** `makeupGain` exists in the spec but in neither Chrome nor Firefox. **`DampenParams.compressor.makeup` must be a separate `GainNode`.**

### 5.11 Open-source projects worth copying from

**Reverb / IR generation**
- [**reverbGen**](https://github.com/adelespinasse/reverbGen) (Apache-2.0) — the reference implementation of procedural IR generation: exponentially-decaying noise, optional fade-in, and a gradual-lowpass pass in an `OfflineAudioContext` for frequency-dependent decay. Small, readable, directly portable.
- [**Tone.js**](https://github.com/Tonejs/Tone.js) — `Tone/effect/Reverb.ts` (decaying-noise convolution, pre-delay via `setValueAtTime`, decay via `exponentialApproachValueAtTime`, rendered in `OfflineContext`, defaults `decay: 1.5, preDelay: 0.01`) and **`Tone/core/context/Param.ts`** (the landing trick in §5.7.2 — copy it verbatim). `JCReverb.ts` / `Freeverb.ts` for algorithmic alternatives.
- [**simple-reverb**](https://github.com/web-audio-components/simple-reverb) — minimal noise-IR convolver in ~60 lines.
- [**Tuna**](https://github.com/Theodeus/tuna) — a full effects library (Convolver, Overdrive, Bitcrusher, Chorus, Phaser, Compressor, Filter, Cabinet, WahWah, Tremolo, Delay, PingPongDelay). The best single "how do people actually wire this" reference for Dampen's whole effect set.

**Noise**
- [**musicdsp #76, Paul Kellett pink noise**](https://www.musicdsp.org/en/latest/Filters/76-pink-noise-filter.html) → [the original coefficient file](https://raw.githubusercontent.com/bdejong/musicdsp/master/source/files/pink.txt) — canonical source for both the refined and economy variants.
- [**noisehack: generate noise with the Web Audio API**](https://noisehack.com/generate-noise-web-audio-api/) — the white/pink/brown JS everyone copies, including the `*= 0.11` pink scaling and the brown leaky integrator. Written against `ScriptProcessorNode`; **port to a worklet.**
- [**pink-noise-node**](https://github.com/mohayonao/pink-noise-node) — Kellett pink as a drop-in node.

**Bitcrush / worklet architecture**
- [**GoogleChromeLabs/web-audio-samples**](https://github.com/GoogleChromeLabs/web-audio-samples) — the Chrome team's samples: `audio-worklet/basic/bit-crusher/`, `noise-gate`, and most importantly **`audio-worklet/design-pattern/`** (WASM-in-worklet, the lock-free `SharedArrayBuffer` ring buffer, worker↔worklet patterns). **If you read one repo for worklet architecture, read this one.**
- The spec itself (§1.32.7) carries the canonical `Bitcrusher` and `VUMeter` processors, quoted above.

**LUFS / loudness**
- [**pyloudnorm**](https://github.com/csteinmetz1/pyloudnorm) — `iirfilter.py` has the `high_shelf_DeMan`/`high_pass_DeMan` designs with `Vb = Vh ** 0.499666774155`, verified to reproduce BS.1770's 48 kHz table exactly. Port the 20 lines.
- [**loudness.py**](https://github.com/BrechtDeMan/loudness.py) — origin of those values, plus De Man's paper on discrepancies between BS.1770 implementations. **Read before trusting any meter.**
- [**needles**](https://github.com/domchristie/needles) — browser loudness metering: momentary / short-term / integrated K-weighted LUFS for live Web Audio sources. The most directly reusable browser implementation.
- [**web-loudness-meter**](https://github.com/m-masaki72/web-loudness-meter) — AudioWorklet + K-weighting, M/S/I per BS.1770-4.

**Vinyl / tape / lo-fi**
- [**vinyl-player**](https://github.com/reagan-pius/vinyl-player) — a real-time **vinyl AudioWorklet DSP chain**: rumble, wow & flutter, surface hiss, crackle/pops, analog saturation, speed-dependent HF roll-off. **The closest thing to a ready-made reference for Dampen's `wowFlutter` + `ambience: 'vinyl'`.**
- [**effetune**](https://github.com/Frieve-A/effetune) — 100+ real-time effects as a Web/PWA app, including `Wow Flutter`, tube amp, AM radio. Large, but a great source of concrete parameter ranges.
- [**oikoaudio/wow**](https://github.com/oikoaudio/wow) — not Web Audio, but the right algorithm: a polyphase windowed-sinc fractional-delay reader whose anti-image cutoff tracks instantaneous playback rate. Use this if Hermite is not clean enough.

**Reference / infrastructure**
- [**web-audio-api spec source**](https://github.com/WebAudio/web-audio-api) — the issue tracker is the only reliable record of which behaviours are contested (#1897 WaveShaper curve setter, #2449 async convolver buffer).
- [**Audio-EQ-Cookbook**](https://github.com/WebAudio/Audio-EQ-Cookbook) — RBJ's cookbook; the source of every coefficient in §5.1.
- [**padenot/web-audio-perf**](https://padenot.github.io/web-audio-perf/) — Paul Adenot's per-node cost/latency/tail-time table. Short and uniquely authoritative.
- [**standardized-audio-context**](https://github.com/chrisguttandin/standardized-audio-context) — a ponyfill normalising the cross-browser differences catalogued here. Worth adopting for Safari parity.
- [**musicdsp archive**](https://github.com/bdejong/musicdsp) — `Effects/42-soft-saturation`, `Effects/114-waveshaper-simple-description`, `Effects/89-2-wave-shaping-things`, `Filters/76-pink-noise-filter`.

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

---

## 7. Where the evidence is thin — a consolidated list

Collected from §1.12, §2.13, §3 and §4 so it can be read in one place. Each item is either a disagreement between sources or a gap this document could not close.

### 7.1 Sources actively disagree

| # | Question | Position A | Position B | What to do |
|---|---|---|---|---|
| 1 | **Filter slope for "through a wall"** | 6–12 dB/oct (physics-faithful; a steeper filter "behaves like no real wall") | 24 dB/oct (common DAW practice) | Measured ASTM E90 data says **~10.5 dB/oct**. Use `stages: 1`. Neither camp models the coincidence notch; §8's `next-room` does. |
| 2 | **Does playback level modulate the ISE?** | Ellermeier & Hellbrück 1998: **no** | 2022 preregistered replication: **yes**, loud distractors are harder to ignore | Unresolved. Dampen's design does not depend on the answer — it never relies on level alone. |
| 3 | **Does the ISE habituate?** | Ellermeier & Zimmer 2014: no | Röer et al. 2014: yes | Unresolved. Affects whether long sessions get easier; does not change any parameter. |
| 4 | **Does non-lyrical music hurt reading at all?** | Vasilev et al. meta-analysis: yes, g ≈ −0.16 | Perham & Currie, Martin et al.: n.s. vs quiet | **Resolved:** the effect is real but too small for N≈30 studies to detect. |
| 5 | **Spread-of-masking slopes** | Terhardt: 27 dB/Bark lower, level-dependent upper | Johnston: +25 / −10 dB/Bark | Use **25–27 / 10–15 dB/Bark** as a band. |
| 6 | **Temporal pre-masking duration** | Painter & Spanias: only 1–2 ms is *significant* | Others: up to 20 ms | Use 2–20 ms, effective 1–5 ms. Post-masking 50–200 ms is agreed. Irrelevant to a continuous bed either way. |
| 7 | **Reverb wet amount for an adjacent room** | 30–50 % | "very wet", 50–80 %, from occlusion logic | **Resolved:** the harder you lowpass the dry path, the higher wet must go. §8 scales them together. |
| 8 | **The BBC/Gundry dip's mechanism** | Psychoacoustic (reduced diffuse-field sensitivity near 3 kHz) | An artefact of woofer beaming vs tweeter energy at a 3 kHz crossover | The −4.2 dB / Q 3.0 figure is one engineer's prescription, not a standard. It sounds right; the explanation is contested. |
| 9 | **Sharpness weighting breakpoint** | z ≤ 15.8 Bark (MathWorks' reading of DIN 45692) | z ≤ 15 Bark (von Bismarck's) | Check DIN 45692 itself before building a sharpness validator. |
| 10 | **Can page-level `getDisplayMedia` capture DRM tab audio?** | Post-CDM argument and extension PoCs say the tap sees decoded PCM | Multiple recorder vendors report silence on Spotify/Netflix | **Needs an empirical test on your target Chrome version.** Extension `chrome.tabCapture` definitely works (§6.6). |

### 7.2 Gaps this document could not close

| # | Gap | Severity | Recommendation |
|---|---|---|---|
| 1 | **No published 1/3-octave spectra for airborne natural soundscapes.** The rain and wind slope figures found (−16 to −20 dB/decade) are **hydrophone** measurements. No fireplace data at all. HVAC data is the only good set. | **High** — `ambience.kind` has 6 natural options | **Measure your own.** A 1/3-octave analysis over ESC-50 / UrbanSound8K will beat anything published. §3.6's deviation table is a design target, not a measurement. |
| 2 | **No study compares mono vs stereo *background music* for distraction.** The BMLD/SRM numbers (3–15 dB) are solid; the bridge to "mono is easier to ignore" is inference. | Medium | A within-subjects reading-comprehension test at width 0 / 0.5 / 1.0 would be a genuinely novel result and cheap to run. |
| 3 | **No standardised figure for vinyl crackle density** in events/second. | Low | Derive from RPM: 0.556 / 0.75 / 1.30 events/s at 33⅓ / 45 / 78. §8 uses this. |
| 4 | **ANSI S3.5-1997 band-importance and vocal-effort tables are paywalled.** Overall levels and structure were confirmed; per-band weights for all materials were not. | Low | The free Byrne LTASS (§3.5) is better-sourced and language-general. Use it as the speech spectrum. |
| 5 | **Streaming-platform LUFS targets are not standards** and the YouTube Music (−7) and Amazon figures come from third-party testing. | Low | Target EBU R 128 (−23 LUFS) instead; it is an actual standard and gives more headroom. |
| 6 | **`DynamicsCompressorNode`'s curve shapes are UA-defined**, so the same settings sound different per browser, and `makeupGain` exists in the spec but in no shipping engine. | **High** — §4.1 specifies a measurable LRA target | Write the AudioWorklet compressor in §5.3.5. The native node cannot hit an LRA spec reliably. |
| 7 | **Kellett pink-noise coefficients are tuned for 44.1 kHz**; K-weighting coefficients are published for 48 kHz only. | Medium | Accept the small pink tilt over 44.1–48 kHz; use the verified De Man reconstruction (§5.8) for K-weighting at any rate. |

### 7.3 Claims in circulation that appear to be fabricated

Stated plainly so they do not re-enter the project through a blog post:

- **"A 2019 *Psychomusicology* study found increased alpha and lower stress at 80 BPM."** Could not be located.
- **"A 2017 *PLOS ONE* study found 60–80 BPM produced the highest sustained attention scores."** Could not be located.
- Use instead: **de Witte et al. 2020, *Health Psychology Review* 14(2):294–324**, which reports music at **60–80 BPM yielding larger effects than other tempos** on *stress* outcomes (§1.9).
- **"70 dB is the optimal level for background music."** Sourced only to weak secondary material and contradicted by a 2024 *Building & Environment* study showing working-memory impairment at ≥ 60 dBA. Do not use.

### 7.4 The three things most worth measuring in-house

1. **A 1/3-octave corpus for the ambience beds** (gap 7.2.1). Directly unblocks `ambience.kind`.
2. **An empirical DRM capture test** on the target Chrome version for page-level `getDisplayMedia` (disagreement 7.1.10). Determines whether architecture #3 in §6.8 can skip the extension.
3. **A width-vs-comprehension trial** (gap 7.2.2). Would convert Dampen's #4 lever from inference to evidence, and is publishable.

---

## 8. RECOMMENDED PRESETS

Eight presets, each a complete `DampenParams` ready to translate into code. Ids match `lib/types.ts`.

### 8.0 Conventions and three contract notes

**Read these before using the tables — two of them are silent-bug territory.**

1. **🔴 `lowpass.q` and `highpass.q` are given in the LINEAR convention** documented in `lib/types.ts` ("Resonance. Keep ≤ 1.0 or the cutoff whistles"). **Web Audio interprets `BiquadFilterNode.Q` as DECIBELS for lowpass and highpass** (§5.1.4). The engine must convert: `filter.Q.value = 20 * Math.log10(q)`. So `q: 0.707` → `Q.value = −3.0103` (Butterworth, maximally flat). `presenceDip.q` is **linear and assigned directly** — peaking filters use the linear convention natively. `lowShelf`/`tilt` ignore Q entirely.
2. **`lowpass.stages` = n means a Butterworth filter of order 2n**, built from `n` biquads using the `BUTTER_Q[2n]` values in §5.1.6 — *not* n identical sections. This gives the documented 12n dB/oct with a flat passband and the −3 dB point exactly at `freq`.
3. **🔴 `ambience` is for the local-audio path only.** Per §6.7, Spotify Developer Policy §III forbids overlapping Spotify Content with any other audio. **On `InputMode === 'spotify'`, force `ambience.kind = 'none'` in the engine, regardless of preset.** Everything in these tables is correct for `'local'` and `'capture'` of the user's own audio. Surface this in the UI as "ambience unavailable on Spotify" rather than silently dropping it.

**Also:**
- `lowShelf.gain` is the ISO 226 loudness compensator (§4.2). Values below assume the stated `outputGain`. If the user attenuates further, **scale it up by ≈ 0.4 dB per additional dB of attenuation, capped at +12 dB.**
- `reverb.preDelay` is in **ms**; `reverb.decay` is **RT60 in seconds**.
- `drift.rate` is deliberately **well below 0.5 Hz** and `drift.depth` at or under ~2 dB — §1.5 says fluctuation strength peaks at 4 Hz and §1.6 that AM becomes noticeable above 2–3 dB. Never raise `drift.rate` toward 4 Hz.
- `saturation` is kept low throughout: roughness carries weight **0.6 vs fluctuation's 0.4** in the Zwicker annoyance model (§1.5), and saturation adds roughness in the 20–300 Hz modulation band. **Lo-fi processing can make the result more annoying, not less.**
- All values are at `amount = 1`. The `macro` list interpolates toward neutral at `amount = 0`.

### 8.1 The presets at a glance

| id | Feel (one line) | Focus strength |
|---|---|---|
| `next-room` | Your music through a closed bedroom door, down the hall, with the party already over. | High |
| `underwater` | Submerged and slow — the song reaching you through a few feet of water. | High |
| `rainy-window` | A record playing in the next flat while rain runs down the glass. | High |
| `tape-memory` | A cassette you taped off the radio in 1994, found in a drawer. | Medium |
| `library` | Barely touched — the song two desks away in a quiet reading room. | Low–Medium |
| `deep-focus` | The evidence-maximal setting. Nearly unrecognisable as music, maximally ignorable. | **Maximum** |
| `distant-radio` | An AM station drifting in and out two rooms away. | Low (see warning) |
| `dream` | Vast, slow and slightly out of tune, like remembering the song rather than hearing it. | Medium |

> ⚠ **`distant-radio` is a stylistic preset, not a focus preset.** Its 300–2700 Hz bandpass is almost exactly the telephone band, which *is* the speech band (§1.4: 500 Hz–4 kHz carries 78.7 % of intelligibility; French & Steinberg's highpass-at-1 kHz still gives 89 % articulation). It maximises verbal interference. Label it honestly in the UI and do not surface it as a "focus" option.

### 8.2 Master parameter table

| Parameter | `next-room` | `underwater` | `rainy-window` | `tape-memory` | `library` | `deep-focus` | `distant-radio` | `dream` |
|---|---|---|---|---|---|---|---|---|
| `amount` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| `outputGain` (dB) | −8 | −9 | −7 | −8 | −6 | −10 | −9 | −9 |
| **`highpass.freq`** | 30 | 40 | 50 | 55 | 40 | 45 | **300** | 45 |
| `highpass.q` | 0.707 | 0.707 | 0.707 | 0.707 | 0.707 | 0.707 | 0.707 | 0.707 |
| **`lowShelf.freq`** | 350 | 300 | 350 | 120 | 320 | 380 | 400 | 300 |
| `lowShelf.gain` (dB) | +4.0 | +5.0 | +3.0 | +3.0 | +2.0 | +6.0 | 0.0 | +4.0 |
| **`lowpass.freq`** | **800** | **500** | **1200** | 1800 | 3200 | **700** | 2700 | 1400 |
| `lowpass.q` *(linear)* | 0.707 | **3.0** | 0.707 | 0.707 | 0.707 | 0.707 | 0.707 | 1.1 |
| `lowpass.stages` | 1 | 2 | 2 | 1 | 1 | **3** | 2 | 2 |
| → resulting slope | 12 dB/oct | 24 | 24 | 12 | 12 | **36** | 24 | 24 |
| **`presenceDip.freq`** | **2200** | 900 | 2800 | 3000 | 3000 | 2400 | 1800 | 2600 |
| `presenceDip.q` *(linear)* | 2.0 | 1.2 | 1.4 | 1.2 | **3.0** | 1.0 | 1.0 | 1.3 |
| `presenceDip.gain` (dB) | **+3.0** ⚠ | −8.0 | −7.0 | −6.0 | **−4.2** | **−12.0** | −3.0 | −8.0 |
| **`tilt.freq`** | 2000 | 1500 | 2500 | 3000 | 2000 | 1600 | 2000 | 2000 |
| `tilt.gain` (dB) | −6 | −10 | −5 | −7 | −4 | −12 | −3 | −8 |
| **`reverb.mix`** | 0.50 | 0.62 | 0.34 | 0.30 | 0.22 | 0.40 | 0.40 | **0.60** |
| `reverb.decay` (s) | 0.50 | 1.80 | 0.55 | 1.10 | 0.80 | 0.70 | 1.30 | **4.00** |
| `reverb.preDelay` (ms) | **8** | 20 | 14 | 25 | 12 | **6** | 35 | **60** |
| `reverb.damping` | 0.75 | 0.85 | 0.60 | 0.55 | 0.45 | **0.90** | 0.50 | 0.50 |
| `reverb.size` | 0.45 | 0.70 | 0.40 | 0.50 | 0.55 | 0.35 | 0.75 | **0.90** |
| **`width`** | 0.20 | 0.50 | 0.45 | 0.55 | 0.70 | **0.00** | 0.10 | **1.40** |
| **`compressor.threshold`** | −32 | −30 | −30 | −26 | −24 | **−34** | −22 | −28 |
| `compressor.ratio` | 8 | 6 | 6 | 4 | 3 | **10** | 12 | 5 |
| `compressor.attack` (s) | 0.002 | 0.005 | 0.003 | 0.010 | 0.020 | **0.002** | 0.004 | 0.008 |
| `compressor.release` (s) | 0.08 | 0.15 | 0.12 | 0.25 | 0.20 | 0.09 | 0.30 | 0.40 |
| `compressor.knee` (dB) | 6 | 9 | 8 | 12 | 12 | 4 | 3 | 12 |
| `compressor.makeup` (dB) | +6 | +5 | +5 | +4 | +2.5 | +7 | +8 | +5 |
| **`saturation`** | 0.10 | 0.08 | 0.05 | **0.30** | 0.02 | **0.00** | 0.22 | 0.12 |
| **`wowFlutter.wowRate`** (Hz) | 0 | 0.25 | 0 | **0.90** | 0 | 0 | 0.70 | **0.15** |
| `wowFlutter.wowDepth` | 0 | 0.50 | 0 | 0.35 | 0 | 0 | 0.10 | 0.40 |
| `wowFlutter.flutterRate` (Hz) | 0 | 3.0 | 0 | **8.0** | 0 | 0 | 11.0 | 4.5 |
| `wowFlutter.flutterDepth` | 0 | 0.12 | 0 | 0.14 | 0 | 0 | 0.08 | 0.06 |
| **`bitcrush.bits`** | 16 | 16 | 16 | **12** | 16 | 16 | **10** | 16 |
| `bitcrush.downsample` | 1 | 1 | 1 | **2** | 1 | 1 | **3** | 1 |
| `bitcrush.mix` | 0 | 0 | 0 | 0.25 | 0 | 0 | 0.18 | 0 |
| **`ambience.kind`** | `none` | `river` | **`rain`** | `tape` | `fan` | **`pink`** | `white` | `pink` |
| `ambience.level` (dBFS) | −60 | −34 | **−30** | −38 | −40 | **−30** | −36 | −42 |
| `ambience.tone` | 0.50 | 0.30 | 0.72 | 0.45 | 0.20 | 0.30 | 0.55 | 0.50 |
| **`drift.rate`** (Hz) | 0.030 | 0.060 | 0.025 | 0.040 | 0.020 | **0.013** | 0.070 | 0.050 |
| `drift.depth` (dB) | 1.2 | 2.0 | 1.0 | 1.6 | 0.8 | 0.5 | 2.5 | 2.0 |

⚠ **`next-room.presenceDip.gain` is POSITIVE (+3 dB) and that is deliberate.** It models the measured **coincidence-leak** of a gypsum partition at 1.6–2.5 kHz (§2.1: −10 dB relative to 1 kHz in the STC 57 lab data, i.e. a *passband leak* right where vocals live). No sound-design tutorial models this, and it is the single detail that makes the preset read as a real wall rather than a lowpass. The 800 Hz / 12 dB-per-octave filter has already dropped 2.2 kHz by ~17 dB, so the net level there is still ≈ −14 dB. **This is a deliberate realism-over-focus trade**; `deep-focus` makes the opposite choice at the same frequency (−12 dB).

### 8.3 Per-preset rationale

**`next-room`** — physics-weighted from the measured ASTM E90 data (§2.1–2.3). 12 dB/oct is the honest slope (measured walls tilt ~10.5 dB/oct); a steeper filter "behaves like no real wall". `lowShelf` at 350 Hz doubles as both the mass-air-mass partition resonance and the ISO 226 compensator. Short pre-delay (8 ms) with high wet (0.50) because the direct path is occluded — what reaches you is the far room's reflection field, not a long free-field path.

**`underwater`** — an artistic convention, not acoustics. Water absorption at musical frequencies is *negligible* (§2.4); real underwater muffling is a flat −30 dB boundary loss plus your ear not working. So the cutoff is chosen by ear from the 300 Hz–5 kHz spread in published recipes. **The `q: 3.0` resonance is what reads as "water"**, not the cutoff. `wowFlutter` here is doing double duty as the slow cutoff/pitch wobble (0.25 Hz) plus a 3 Hz vibrato.

**`rainy-window`** — the best *masking* preset. Rain is HF-weighted, which per §3.3 makes it the most efficient masker of the 2–5 kHz presence region per dB of added loudness — hence the highest `ambience.level` (−30 dBFS) and `tone` (0.72). Window glass is stiffer than drywall, so 24 dB/oct is defensible here where it is not for `next-room`.

**`tape-memory`** — §2.12 throughout. `wowRate 0.9 Hz` and `wowDepth 0.35` give ≈ 0.5 % speed deviation ≈ 8.7 cents — **10× real cassette spec (0.08 %)**, because real specs are inaudible by design. `flutterRate 8 Hz` is above the 6 Hz wow/flutter boundary. `bits 12 / downsample 2` is SP-1200 territory; note the post-crush lowpass in §5.5.3 is **not optional**. `saturation 0.30` is the highest in the set and is the one place this document recommends accepting added roughness for character.

**`library`** — deliberately the least processed, and standards-backed: `tilt` at 2000 Hz is the **SMPTE X-curve** start point (flat to 2 kHz, then −3 dB/oct — the film industry's codified "distance" EQ), and `presenceDip` is the **BBC/Gundry dip** at exactly 3 kHz / Q 3.0 / −4.2 dB. `ambience: 'fan'` because HVAC noise is LF-dominant (63/125/250 Hz octaves) — the weakest masker but the lowest fatigue, which is right for an 8-hour preset. This should be the default for first-time users.

**`deep-focus`** — built from §1.13's four highest-confidence targets rather than from any sonic reference. `lowpass 700 Hz @ 36 dB/oct` + `presenceDip −12 dB` + `tilt −12 dB` collapses the speech band toward the **≤ 2 effective spectral channels** that Ellermeier et al. 2012 showed produces **no ISE vs silence**. `width 0.00` is true mono, removing up to 12 dB of spatial release from masking (§2.10). `saturation 0.00` and `wowFlutter` all-zero because added roughness and pitch motion both work against the goal. `compressor` at ratio 10 / attack 2 ms targets the **LRA 3–6 LU** spec from §4.1. `ambience: 'pink'` with `tone 0.30` approximates the NRC optimum masking contour (§3.3) — **not `'brown'`, which has zero supporting studies.**

**`distant-radio`** — see the warning in §8.1. Values from §2.5 (musicguymixing's 300 Hz / 2700 Hz at 24 dB/oct). `compressor` at ratio 12 / release 0.30 mimics radio AGC; `drift.depth 2.5 dB` is signal fading and is the only preset at the edge of the 2–3 dB noticeability threshold — deliberately, because being noticed is the point here.

**`dream`** — §2.7. `reverb.decay 4.0 s` with `preDelay 60 ms` and `size 0.90`; `width 1.40` (the literature's 150–200 %); `wowRate 0.15 Hz` at `depth 0.40` ≈ ±20 cents. The only preset with `width > 1`, which per §2.10 means it is the *least* effective at reducing attentional salience. It is an aesthetic preset — honest about it.

### 8.4 Ready-to-paste TypeScript

```ts
import type { Preset, DampenParams } from './types';

/** Shared macro map: what the big dial interpolates, and toward what neutral. */
const MACRO_DEFAULT: NonNullable<Preset['macro']> = [
  { path: 'lowpass.freq',       neutral: 20000 },
  { path: 'presenceDip.gain',   neutral: 0 },
  { path: 'tilt.gain',          neutral: 0 },
  { path: 'lowShelf.gain',      neutral: 0 },
  { path: 'reverb.mix',         neutral: 0 },
  { path: 'width',              neutral: 1 },
  { path: 'compressor.ratio',   neutral: 1 },
  { path: 'compressor.makeup',  neutral: 0 },
  { path: 'saturation',         neutral: 0 },
  { path: 'ambience.level',     neutral: -90 },
  { path: 'drift.depth',        neutral: 0 },
  { path: 'outputGain',         neutral: 0 },
];

// NOTE: interpolate `lowpass.freq` GEOMETRICALLY, not linearly —
//   f(a) = neutral * (target / neutral) ** a
// Linear-in-Hz spends ~95% of the dial above 1 kHz and feels broken (§5.7.8).
// Same for `ambience.level` and any other dB-domain field: lerp in dB, not in linear gain.

export const PRESETS: Preset[] = [
  {
    id: 'next-room',
    name: 'Next Room',
    blurb: 'Your music through a closed door, down the hall, with the party already over.',
    glyph: '🚪',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -8,
      highpass:    { freq: 30,  q: 0.707 },
      lowShelf:    { freq: 350, gain: 4.0 },
      lowpass:     { freq: 800, q: 0.707, stages: 1 },
      presenceDip: { freq: 2200, q: 2.0, gain: 3.0 },   // + = the wall's coincidence leak
      tilt:        { freq: 2000, gain: -6 },
      reverb:      { mix: 0.50, decay: 0.50, preDelay: 8, damping: 0.75, size: 0.45 },
      width: 0.20,
      compressor:  { threshold: -32, ratio: 8, attack: 0.002, release: 0.08, knee: 6, makeup: 6 },
      saturation: 0.10,
      wowFlutter:  { wowRate: 0, wowDepth: 0, flutterRate: 0, flutterDepth: 0 },
      bitcrush:    { bits: 16, downsample: 1, mix: 0 },
      ambience:    { kind: 'none', level: -60, tone: 0.50 },
      drift:       { rate: 0.030, depth: 1.2 },
    },
  },
  {
    id: 'underwater',
    name: 'Underwater',
    blurb: 'Submerged and slow — the song reaching you through a few feet of water.',
    glyph: '🌊',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -9,
      highpass:    { freq: 40,  q: 0.707 },
      lowShelf:    { freq: 300, gain: 5.0 },
      lowpass:     { freq: 500, q: 3.0, stages: 2 },     // q is the "water", not the cutoff
      presenceDip: { freq: 900, q: 1.2, gain: -8.0 },
      tilt:        { freq: 1500, gain: -10 },
      reverb:      { mix: 0.62, decay: 1.80, preDelay: 20, damping: 0.85, size: 0.70 },
      width: 0.50,
      compressor:  { threshold: -30, ratio: 6, attack: 0.005, release: 0.15, knee: 9, makeup: 5 },
      saturation: 0.08,
      wowFlutter:  { wowRate: 0.25, wowDepth: 0.50, flutterRate: 3.0, flutterDepth: 0.12 },
      bitcrush:    { bits: 16, downsample: 1, mix: 0 },
      ambience:    { kind: 'river', level: -34, tone: 0.30 },
      drift:       { rate: 0.060, depth: 2.0 },
    },
  },
  {
    id: 'rainy-window',
    name: 'Rainy Window',
    blurb: 'A record playing in the next flat while rain runs down the glass.',
    glyph: '🌧️',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -7,
      highpass:    { freq: 50,  q: 0.707 },
      lowShelf:    { freq: 350, gain: 3.0 },
      lowpass:     { freq: 1200, q: 0.707, stages: 2 },
      presenceDip: { freq: 2800, q: 1.4, gain: -7.0 },
      tilt:        { freq: 2500, gain: -5 },
      reverb:      { mix: 0.34, decay: 0.55, preDelay: 14, damping: 0.60, size: 0.40 },
      width: 0.45,
      compressor:  { threshold: -30, ratio: 6, attack: 0.003, release: 0.12, knee: 8, makeup: 5 },
      saturation: 0.05,
      wowFlutter:  { wowRate: 0, wowDepth: 0, flutterRate: 0, flutterDepth: 0 },
      bitcrush:    { bits: 16, downsample: 1, mix: 0 },
      ambience:    { kind: 'rain', level: -30, tone: 0.72 },  // best presence-band masker
      drift:       { rate: 0.025, depth: 1.0 },
    },
  },
  {
    id: 'tape-memory',
    name: 'Tape Memory',
    blurb: 'A cassette you taped off the radio in 1994, found in a drawer.',
    glyph: '📼',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -8,
      highpass:    { freq: 55,  q: 0.707 },
      lowShelf:    { freq: 120, gain: 3.0 },              // tape head bump @ 15 ips ≈ 60 Hz
      lowpass:     { freq: 1800, q: 0.707, stages: 1 },
      presenceDip: { freq: 3000, q: 1.2, gain: -6.0 },
      tilt:        { freq: 3000, gain: -7 },
      reverb:      { mix: 0.30, decay: 1.10, preDelay: 25, damping: 0.55, size: 0.50 },
      width: 0.55,
      compressor:  { threshold: -26, ratio: 4, attack: 0.010, release: 0.25, knee: 12, makeup: 4 },
      saturation: 0.30,
      // 0.35 depth ≈ 0.5% speed deviation ≈ 8.7 cents — 10x real cassette spec, on purpose
      wowFlutter:  { wowRate: 0.90, wowDepth: 0.35, flutterRate: 8.0, flutterDepth: 0.14 },
      bitcrush:    { bits: 12, downsample: 2, mix: 0.25 }, // SP-1200 territory
      ambience:    { kind: 'tape', level: -38, tone: 0.45 },
      drift:       { rate: 0.040, depth: 1.6 },
    },
  },
  {
    id: 'library',
    name: 'Library',
    blurb: 'Barely touched — the song two desks away in a quiet reading room.',
    glyph: '📚',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -6,
      highpass:    { freq: 40,  q: 0.707 },
      lowShelf:    { freq: 320, gain: 2.0 },
      lowpass:     { freq: 3200, q: 0.707, stages: 1 },
      presenceDip: { freq: 3000, q: 3.0, gain: -4.2 },    // the BBC / Gundry dip, exactly
      tilt:        { freq: 2000, gain: -4 },               // SMPTE X-curve start point
      reverb:      { mix: 0.22, decay: 0.80, preDelay: 12, damping: 0.45, size: 0.55 },
      width: 0.70,
      compressor:  { threshold: -24, ratio: 3, attack: 0.020, release: 0.20, knee: 12, makeup: 2.5 },
      saturation: 0.02,
      wowFlutter:  { wowRate: 0, wowDepth: 0, flutterRate: 0, flutterDepth: 0 },
      bitcrush:    { bits: 16, downsample: 1, mix: 0 },
      ambience:    { kind: 'fan', level: -40, tone: 0.20 },  // LF-dominant: weakest masker, lowest fatigue
      drift:       { rate: 0.020, depth: 0.8 },
    },
  },
  {
    id: 'deep-focus',
    name: 'Deep Focus',
    blurb: 'Nearly unrecognisable as music, and maximally ignorable — the evidence-maximal setting.',
    glyph: '🎯',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -10,
      highpass:    { freq: 45,  q: 0.707 },
      lowShelf:    { freq: 380, gain: 6.0 },
      lowpass:     { freq: 700, q: 0.707, stages: 3 },     // 36 dB/oct → ≤2 spectral channels
      presenceDip: { freq: 2400, q: 1.0, gain: -12.0 },
      tilt:        { freq: 1600, gain: -12 },
      reverb:      { mix: 0.40, decay: 0.70, preDelay: 6, damping: 0.90, size: 0.35 },
      width: 0.00,                                         // removes up to 12 dB of SRM
      compressor:  { threshold: -34, ratio: 10, attack: 0.002, release: 0.09, knee: 4, makeup: 7 },
      saturation: 0.00,                                    // roughness weighs 0.6 in w_FR
      wowFlutter:  { wowRate: 0, wowDepth: 0, flutterRate: 0, flutterDepth: 0 },
      bitcrush:    { bits: 16, downsample: 1, mix: 0 },
      ambience:    { kind: 'pink', level: -30, tone: 0.30 }, // ≈ NRC optimum masking contour
      drift:       { rate: 0.013, depth: 0.5 },
    },
  },
  {
    id: 'distant-radio',
    name: 'Distant Radio',
    blurb: 'An AM station drifting in and out two rooms away. Stylistic — not a focus setting.',
    glyph: '📻',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -9,
      highpass:    { freq: 300, q: 0.707 },                // ITU-T G.712 narrowband
      lowShelf:    { freq: 400, gain: 0.0 },               // no bass left to compensate
      lowpass:     { freq: 2700, q: 0.707, stages: 2 },
      presenceDip: { freq: 1800, q: 1.0, gain: -3.0 },
      tilt:        { freq: 2000, gain: -3 },
      reverb:      { mix: 0.40, decay: 1.30, preDelay: 35, damping: 0.50, size: 0.75 },
      width: 0.10,
      compressor:  { threshold: -22, ratio: 12, attack: 0.004, release: 0.30, knee: 3, makeup: 8 },
      saturation: 0.22,
      wowFlutter:  { wowRate: 0.70, wowDepth: 0.10, flutterRate: 11.0, flutterDepth: 0.08 },
      bitcrush:    { bits: 10, downsample: 3, mix: 0.18 },
      ambience:    { kind: 'white', level: -36, tone: 0.55 },
      drift:       { rate: 0.070, depth: 2.5 },            // signal fading; at the noticeability edge
    },
  },
  {
    id: 'dream',
    name: 'Dream',
    blurb: 'Vast, slow and slightly out of tune — remembering the song rather than hearing it.',
    glyph: '💭',
    macro: MACRO_DEFAULT,
    params: {
      amount: 1,
      outputGain: -9,
      highpass:    { freq: 45,  q: 0.707 },
      lowShelf:    { freq: 300, gain: 4.0 },
      lowpass:     { freq: 1400, q: 1.1, stages: 2 },
      presenceDip: { freq: 2600, q: 1.3, gain: -8.0 },
      tilt:        { freq: 2000, gain: -8 },
      reverb:      { mix: 0.60, decay: 4.00, preDelay: 60, damping: 0.50, size: 0.90 },
      width: 1.40,                                         // the only preset > 1; aesthetic choice
      compressor:  { threshold: -28, ratio: 5, attack: 0.008, release: 0.40, knee: 12, makeup: 5 },
      saturation: 0.12,
      wowFlutter:  { wowRate: 0.15, wowDepth: 0.40, flutterRate: 4.5, flutterDepth: 0.06 },
      bitcrush:    { bits: 16, downsample: 1, mix: 0 },
      ambience:    { kind: 'pink', level: -42, tone: 0.50 },
      drift:       { rate: 0.050, depth: 2.0 },
    },
  },
];
```

### 8.5 Two implementation details the tables cannot carry

**Geometric interpolation for the macro dial.** `lowpass.freq` must interpolate as `neutral * (target/neutral) ** amount`, not linearly (§5.7.8). Linear-in-Hz from 20 kHz to 700 Hz spends ~95 % of the dial above 1 kHz and feels broken. Same rule for every dB-domain field (`ambience.level`, all gains): interpolate **in dB**, never in linear gain.

**Preset switching must not click.** A preset change moves ~30 parameters at once. Use the `retarget()` idiom from §5.7.5 on every `AudioParam` (`cancelAndHoldAtTime` → `setValueAtTime` → ramp), with `exponentialRampToValueAtTime` for frequencies and `setTargetAtTime(τ ≈ 0.05–0.15 s)` for gains. Two parameters cannot be ramped at all and need a cross-fade between parallel nodes:

| Parameter | Why | Handling |
|---|---|---|
| `reverb.decay` / `size` | Changes the IR; `ConvolverNode.buffer` glitches and blocks the main thread ~35 ms per second of IR (§5.2.6) | Pre-render all 8 IRs at load; keep two convolvers and cross-fade over ~250 ms |
| `saturation` | `WaveShaperNode.curve` may be one-shot per spec, and swapping it is a discontinuity (§5.4.1) | Two shapers in parallel, cross-fade; set `oversample: 'none'` on the idle one (WebKit bug) |

A preset change is also, in the terms of §1.2, a **deviant** — and deviation effects run d = 0.93–1.22 and add ~4 pp to serial-recall error. **Make preset transitions slow (≥ 1 s) and never automatic.** For the same reason, do not crossfade between tracks of different spectral character mid-session if you can avoid it.

