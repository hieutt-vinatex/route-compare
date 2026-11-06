import type { Tone } from '@/components/ui/StatusPill';
import type { QualityLabel } from '@/domain/models/types';

/** docs/05 §8 quality label → pill tone (the label text is always shown too). */
export function qualityTone(label: QualityLabel): Tone {
  return label === 'GOOD' ? 'ok' : label === 'FAIR' ? 'info' : 'warn';
}
