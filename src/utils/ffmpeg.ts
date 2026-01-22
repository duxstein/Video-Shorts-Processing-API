/**
 * FFmpeg conversion: pad and blur modes. Uses spawn, configurable timeout.
 * H.264 + AAC, mp4 output.
 * Timeout: FFMPEG_TIMEOUT_SEC env (default 600). Process killed on timeout.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ProcessOptions } from '../types';
import { FFMPEG_TIMEOUT_SEC_DEFAULT } from '../types';

const FFMPEG = 'ffmpeg';

const MIN_TIMEOUT_SEC = 60;
const MAX_TIMEOUT_SEC = 3600;

function getFfmpegTimeoutSec(): number {
  const raw = process.env.FFMPEG_TIMEOUT_SEC;
  if (raw === undefined || raw === '') return FFMPEG_TIMEOUT_SEC_DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_TIMEOUT_SEC) return FFMPEG_TIMEOUT_SEC_DEFAULT;
  return Math.min(n, MAX_TIMEOUT_SEC);
}

function safePath(p: string): string {
  const resolved = path.resolve(p);
  return resolved;
}

/**
 * Convert video to Shorts format (1080x1920). Writes to outputPath.
 * mode: 'pad' | 'blur'
 */
export function convertToShorts(
  inputPath: string,
  outputPath: string,
  options: ProcessOptions,
): Promise<void> {
  const mode = options.mode;
  const w = options.targetWidth;
  const h = options.targetHeight;
  const inPath = safePath(inputPath);
  const outPath = safePath(outputPath);
  const timeoutSec = getFfmpegTimeoutSec();
  const timeoutMs = timeoutSec * 1000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (): void => { settled = true; };

    const args: string[] = ['-y', '-i', inPath];

    if (mode === 'pad') {
      // scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2
      args.push(
        '-vf', `scale=${w}:-2:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
        '-map', '0:v',
        '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-shortest',
        outPath,
      );
    } else {
      // blur: [0] scale+pad+blur as bg, [0] scale as fg, overlay
      // bg: scale to cover 1080x1920, then crop, then blur
      // fg: scale to 1080 width, keep aspect
      const filter = [
        `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:10[bg]`,
        `[0:v]scale=${w}:-2[fg]`,
        `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:format=auto[v]`,
      ].join(';');
      args.push(
        '-filter_complex', filter,
        '-map', '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-shortest',
        outPath,
      );
    }

    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      finish();
      clearTimeout(timeoutId);
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timeout after ${timeoutSec}s`));
    }, timeoutMs);

    proc.on('error', (err) => {
      if (settled) return;
      finish();
      clearTimeout(timeoutId);
      reject(new Error(`ffmpeg spawn failed: ${(err as Error).message}`));
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      if (settled) return;
      finish();
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code ?? signal}. stderr: ${stderr.slice(-2000)}`));
        return;
      }
      if (!fs.existsSync(outPath)) {
        reject(new Error('ffmpeg completed but output file missing'));
        return;
      }
      resolve();
    });
  });
}
