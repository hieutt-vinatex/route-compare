/**
 * Zustand holds UI preferences only (ADR-04). GPS points / trips are NOT stored here —
 * the repository is the source of truth and the TrackingController exposes live state.
 */
import { create } from 'zustand';
import type { TransportMode } from '@/domain/models/types';

interface UiState {
  readonly transportMode: TransportMode;
  readonly tripName: string;
  readonly showAccuracyCircle: boolean;
  /** `to` timestamp of the hidden-interval notice the user dismissed. */
  readonly dismissedHiddenNoticeAt: number | null;
  setTransportMode: (mode: TransportMode) => void;
  setTripName: (name: string) => void;
  setShowAccuracyCircle: (show: boolean) => void;
  dismissHiddenNotice: (at: number) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  transportMode: 'MOTORBIKE',
  tripName: '',
  showAccuracyCircle: true,
  dismissedHiddenNoticeAt: null,
  setTransportMode: (transportMode) => {
    set({ transportMode });
  },
  setTripName: (tripName) => {
    set({ tripName });
  },
  setShowAccuracyCircle: (showAccuracyCircle) => {
    set({ showAccuracyCircle });
  },
  dismissHiddenNotice: (at) => {
    set({ dismissedHiddenNoticeAt: at });
  },
}));
