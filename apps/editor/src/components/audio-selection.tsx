// apps/editor/src/components/audio-selection.tsx
//
// A tiny React context that tracks which AUDIO TRACK is selected — the core
// store's `selection: Id[]` only holds NODE ids, and audio tracks are not
// nodes. Rather than widen the store slice, this mirrors the existing
// `SpanLaneContext` pattern: a provider near the app root, a hook for
// consumers (LayerPanel's audio sub-list, the timeline audio rows, and the
// InspectorPanel).
//
// Selecting an audio track also CLEARS the node selection (via the store) so
// the inspector unambiguously switches to the audio view — and selecting any
// node should clear the audio selection (call `clearAudio()` from wherever
// node selection happens, or rely on `useSyncAudioWithNodeSelection` below).

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Id } from "core";
import { useEditorStore, useEditorStoreApi } from "../store/context";

interface AudioSelectionValue {
  selectedAudioId: Id | null;
  /** Select an audio track (clears node selection). Pass null to clear. */
  selectAudio(id: Id | null): void;
  clearAudio(): void;
}

const AudioSelectionContext = createContext<AudioSelectionValue | null>(null);

export function AudioSelectionProvider({ children }: { children: ReactNode }) {
  const store = useEditorStoreApi();
  const [selectedAudioId, setSelectedAudioId] = useState<Id | null>(null);

  const selectAudio = useCallback((id: Id | null) => {
    setSelectedAudioId(id);
    if (id) store.getState().select([]); // audio + node selection are mutually exclusive
  }, [store]);

  const clearAudio = useCallback(() => setSelectedAudioId(null), []);

  const value = useMemo<AudioSelectionValue>(
    () => ({ selectedAudioId, selectAudio, clearAudio }),
    [selectedAudioId, selectAudio, clearAudio],
  );

  return <AudioSelectionContext.Provider value={value}>{children}</AudioSelectionContext.Provider>;
}

export function useAudioSelection(): AudioSelectionValue {
  const ctx = useContext(AudioSelectionContext);
  if (!ctx) throw new Error("useAudioSelection must be used within <AudioSelectionProvider>");
  return ctx;
}

/**
 * Optional convenience: clears the audio selection whenever a NODE becomes
 * selected, keeping the two selections mutually exclusive without threading a
 * callback through every node-selecting call site. Mount once (e.g. in the
 * component that renders the inspector).
 */
export function useSyncAudioWithNodeSelection(): void {
  const { selectedAudioId, clearAudio } = useAudioSelection();
  const selection = useEditorStore((s) => s.selection);
  useEffect(() => {
    if (selection.length > 0 && selectedAudioId) clearAudio();
  }, [selection, selectedAudioId, clearAudio]);
}
