/**
 * FFprobe wrapper: read video metadata via spawn, no shell.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import type { VideoMetadata } from '../types';

const FFPROBE = 'ffprobe';

interface FFprobeStream {
  codec_type: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FFprobeFormat {
  duration?: string;
}

interface FFprobeOutput {
  streams?: FFprobeStream[];
  format?: FFprobeFormat;
}

/**
 * Resolve path. Only allow absolute paths under system temp.
 */
function safePath(input: string): string {
  const resolved = path.resolve(input);
  const tmp = process.platform === 'win32'
    ? (process.env.TEMP ?? process.env.TMP ?? 'C:\\Windows\\Temp')
    : '/tmp';
  const base = path.resolve(tmp);
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const baseNorm = process.platform === 'win32' ? base.toLowerCase() : base;
  if (!normalized.startsWith(baseNorm)) {
    throw new Error('Path must be under temp directory');
  }
  return resolved;
}

/**
 * Run ffprobe -v error -show_entries stream=width,height,duration,codec_type
 * -show_entries format=duration -of json on file.
 * Returns { width, height, durationSec, aspectRatio, hasAudio }.
 */
export function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
  const safe = safePath(filePath);
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=width,height,duration,codec_type',
      '-show_entries', 'format=duration',
      '-of', 'json',
      '-i', safe,
    ];
    const proc = spawn(FFPROBE, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      reject(new Error(`ffprobe spawn failed: ${(err as Error).message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}. stderr: ${stderr}`));
        return;
      }
      try {
        const json: FFprobeOutput = JSON.parse(stdout);
        const streams = json.streams ?? [];
        const format = json.format ?? {};

        let width = 0;
        let height = 0;
        let durationSec = 0;
        let hasAudio = false;

        for (const s of streams) {
          if (s.codec_type === 'video') {
            width = s.width ?? 0;
            height = s.height ?? 0;
            const d = s.duration ?? format.duration;
            if (d) durationSec = parseFloat(d);
          }
          if (s.codec_type === 'audio') hasAudio = true;
        }

        if (!width || !height) {
          reject(new Error('ffprobe: no video stream or missing width/height'));
          return;
        }
        if (durationSec <= 0 && format.duration) {
          durationSec = parseFloat(format.duration);
        }

        const aspectRatio = height > 0 ? width / height : 0;
        resolve({
          width,
          height,
          durationSec,
          aspectRatio,
          hasAudio,
        });
      } catch (e) {
        reject(new Error(`ffprobe: failed to parse JSON: ${(e as Error).message}`));
      }
    });
  });
}
