/**
 * Temporary file handling: unique paths in /tmp, cleanup, concurrency-safe.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MAX_FILE_SIZE_BYTES } from '../types';

const TMP_DIR = process.platform === 'win32' ? path.join(process.env.TEMP ?? 'C:\\Windows\\Temp', 'shorts-api') : '/tmp/shorts-api';

/**
 * Ensure base tmp dir exists. Uses sync to avoid races on first request.
 */
function ensureTmpDir(): string {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
  return TMP_DIR;
}

/**
 * Generate a unique subdir for this request. Caller is responsible for cleanup.
 */
export function createUniqueTmpDir(): string {
  const base = ensureTmpDir();
  const sub = path.join(base, uuidv4());
  fs.mkdirSync(sub, { recursive: true });
  return sub;
}

/**
 * Sanitize filename: only allow alphanumeric, dash, underscore, dot.
 * Used for Content-Disposition, not for filesystem paths.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'video';
}

/**
 * Build output path: dir + fixed output.mp4. No user input.
 */
export function outputPath(dir: string): string {
  return path.join(dir, 'output.mp4');
}

/**
 * Check file size. Throws if over limit.
 */
export function assertFileSize(bytes: number): void {
  if (bytes > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
  }
}

/**
 * Recursively delete a directory and all contents. Idempotent.
 */
export function rmDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) rmDirRecursive(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(dir);
}
