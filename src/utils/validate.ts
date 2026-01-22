/**
 * Shorts validation: vertical, 9:16 aspect, duration <= max.
 */

import type { ProcessOptions, ShortsValidation, VideoMetadata } from '../types';
import { TARGET_ASPECT } from '../types';

export function validateShorts(
  meta: VideoMetadata,
  options: ProcessOptions,
): ShortsValidation {
  const { maxDurationSec, tolerance } = options;
  const isVertical = meta.height > meta.width;
  const aspect = meta.aspectRatio;
  const aspectOk = Math.abs(aspect - TARGET_ASPECT) <= tolerance;
  const durationOk = meta.durationSec <= maxDurationSec;

  const reasons: string[] = [];
  if (!isVertical) reasons.push('NOT_VERTICAL');
  if (!aspectOk) reasons.push('ASPECT_RATIO_MISMATCH');
  if (!durationOk) reasons.push('DURATION_EXCEEDED');

  const shortsEligible = durationOk && isVertical && aspectOk;

  return {
    isVertical,
    aspectOk,
    durationOk,
    shortsEligible,
    reasons,
  };
}
