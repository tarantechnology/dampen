'use client';

import { useCallback, useEffect, useRef } from 'react';
import { PRESETS, useDampen } from '@/lib/audio/useDampen';
import { clamp } from '@/components/ui/accent';
import { useUIStore } from '@/components/ui/store';
import { DampenSlider } from './DampenSlider';
import { PresetChips } from './PresetChips';

/** Where the slider lands when you pick a character from a standing start. */
const OPENING_AMOUNT = 0.7;

/**
 * The engine island: the macro and the preset row, and nothing else.
 *
 * Everything that used to sit beside these — the source switcher, the DSP
 * tree, the analyser, the meters — now lives in the settings sheet, which
 * owns its own `useDampen()` subscription and only mounts while it is open.
 */
export function EngineIsland() {
  const dampen = useDampen();
  const amount = dampen.params.amount;
  const presetId = dampen.presetId;
  const bypass = dampen.bypass;

  const publishDampen = useUIStore((s) => s.publishDampen);
  const registerActions = useUIStore((s) => s.registerActions);

  /*
   * Capture is the path that can actually filter Spotify, so it is the
   * default. Set once, from the island that is always mounted — the settings
   * sheet is where you change it, but it must not be where you discover it.
   */
  const chosenMode = useRef(false);
  useEffect(() => {
    if (chosenMode.current) return;
    chosenMode.current = true;
    dampen.setInputMode('capture');
  }, [dampen]);

  /* Mirrored out purely so the artwork filter can follow the macro. */
  useEffect(() => {
    publishDampen({ amount, bypass });
  }, [amount, bypass, publishDampen]);

  /* Latest-value refs: the keyboard commands run outside render and must not
     re-register every time the slider moves. */
  const amountRef = useRef(amount);
  const bypassRef = useRef(bypass);
  const presetRef = useRef(presetId);
  useEffect(() => {
    amountRef.current = amount;
    bypassRef.current = bypass;
    presetRef.current = presetId;
  }, [amount, bypass, presetId]);

  /**
   * The macro only means something once a character is chosen. Nothing has
   * been chosen on first load, so the first push off zero quietly adopts the
   * first preset rather than moving a dial that does nothing.
   */
  const setAmount = useCallback(
    (next: number) => {
      if (next > 0 && !presetRef.current) {
        dampen.applyPreset(PRESETS[0].id);
      }
      dampen.setAmount(clamp(next, 0, 1));
    },
    [dampen],
  );

  const selectPreset = useCallback(
    (id: string | null) => {
      if (id === null) {
        dampen.setAmount(0);
        return;
      }
      dampen.applyPreset(id);
      if (amountRef.current < 0.05) dampen.setAmount(OPENING_AMOUNT);
    },
    [dampen],
  );

  useEffect(() => {
    registerActions({
      nudgeAmount: (delta) => setAmount(clamp(amountRef.current + delta, 0, 1)),
      toggleBypass: () => dampen.setBypass(!bypassRef.current),
      selectPresetIndex: (index) => {
        const preset = PRESETS[index];
        if (preset) selectPreset(preset.id);
      },
    });
  }, [dampen, registerActions, setAmount, selectPreset]);

  const selectedId = amount > 0.001 ? presetId || null : null;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <DampenSlider value={amount} onChange={setAmount} disabled={bypass} />
      <PresetChips
        presets={PRESETS}
        selectedId={selectedId}
        onSelect={selectPreset}
        disabled={bypass}
      />
    </div>
  );
}
