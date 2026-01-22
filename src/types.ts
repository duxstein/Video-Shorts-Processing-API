/**
 * Shared types for Video Shorts Processing API
 */

export interface VideoMetadata {
  width: number;
  height: number;
  durationSec: number;
  aspectRatio: number;
  hasAudio: boolean;
}

export interface ShortsValidation {
  isVertical: boolean;
  aspectOk: boolean;
  durationOk: boolean;
  shortsEligible: boolean;
  reasons: string[];
}

export type ConversionMode = 'pad' | 'blur';

export interface ProcessOptions {
  mode: ConversionMode;
  targetWidth: number;
  targetHeight: number;
  maxDurationSec: number;
  tolerance: number;
  forceConvert: boolean;
}

export const DEFAULT_PROCESS_OPTIONS: ProcessOptions = {
  mode: 'blur',
  targetWidth: 1080,
  targetHeight: 1920,
  maxDurationSec: 60,
  tolerance: 0.08,
  forceConvert: false,
};

export const TARGET_ASPECT = 9 / 16;
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB
export const FFMPEG_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
