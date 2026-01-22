/**
 * POST /process/shorts and POST /inspect routes.
 */

import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { convertToShorts } from '../utils/ffmpeg';
import { getVideoMetadata } from '../utils/ffprobe';
import {
  createUniqueTmpDir,
  outputPath,
  rmDirRecursive,
  sanitizeFilename,
} from '../utils/tmp';
import { assertFileSize } from '../utils/tmp';
import { validateShorts } from '../utils/validate';
import {
  type ConversionMode,
  DEFAULT_PROCESS_OPTIONS,
  MAX_FILE_SIZE_BYTES,
  type ProcessOptions,
} from '../types';

const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
const ALLOWED_MIMES = new Set(VIDEO_MIMES);

function isVideoMime(mime: string): boolean {
  if (!mime) return false;
  if (ALLOWED_MIMES.has(mime)) return true;
  return mime.startsWith('video/');
}

function parseProcessOptions(body: Record<string, unknown>): ProcessOptions {
  const modeRaw = body.mode as string | undefined;
  const mode: ConversionMode =
    modeRaw === 'pad' || modeRaw === 'blur' ? modeRaw : DEFAULT_PROCESS_OPTIONS.mode;

  const targetWidth = Math.max(1, Math.min(4096, Number(body.targetWidth) || DEFAULT_PROCESS_OPTIONS.targetWidth));
  const targetHeight = Math.max(1, Math.min(4096, Number(body.targetHeight) || DEFAULT_PROCESS_OPTIONS.targetHeight));
  const maxDurationSec = Math.max(1, Math.min(300, Number(body.maxDurationSec) || DEFAULT_PROCESS_OPTIONS.maxDurationSec));
  const tolerance = Math.max(0.001, Math.min(0.5, Number(body.tolerance) ?? DEFAULT_PROCESS_OPTIONS.tolerance));
  const forceConvert = body.forceConvert === 'true' || body.forceConvert === true;

  return {
    mode,
    targetWidth,
    targetHeight,
    maxDurationSec,
    tolerance,
    forceConvert,
  };
}

/**
 * Middleware: create requestId and unique tmp dir, attach to req.
 */
export function processTmpMiddleware(req: Request, _res: Response, next: () => void): void {
  (req as Request & { requestId: string; uniqueTmpDir: string }).requestId = uuidv4();
  (req as Request & { uniqueTmpDir: string }).uniqueTmpDir = createUniqueTmpDir();
  next();
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = (_req as Request & { uniqueTmpDir: string }).uniqueTmpDir;
    if (!dir) return cb(new Error('missing uniqueTmpDir'), '');
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const raw = file.originalname || 'video';
    const ext = path.extname(raw) || '.mp4';
    const base = path.basename(raw, ext) || 'video';
    const safe = sanitizeFilename(base) + ext;
    cb(null, safe);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter(_req, file, cb) {
    const mime = file.mimetype;
    if (!isVideoMime(mime)) {
      cb(new Error('FILE_NOT_VIDEO'));
      return;
    }
    cb(null, true);
  },
});

/**
 * POST /process/shorts
 */
export async function processShorts(req: Request, res: Response): Promise<void> {
  const reqId = (req as Request & { requestId: string }).requestId;
  const tmpDir = (req as Request & { uniqueTmpDir: string }).uniqueTmpDir;
  const start = Date.now();

  try {
    if (!req.file) {
      res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded. Use multipart field "file".' });
      return;
    }

    assertFileSize(req.file.size);

    const options = parseProcessOptions((req.body as Record<string, unknown>) || {});
    const inputPath = req.file.path;
    const meta = await getVideoMetadata(inputPath);
    const validation = validateShorts(meta, options);

    const shouldConvert =
      options.forceConvert || !validation.shortsEligible;

    let outPath: string;
    let converted = false;
    let conversionMode: ConversionMode = options.mode;
    let finalMeta = meta;

    if (shouldConvert) {
      outPath = outputPath(tmpDir);
      await convertToShorts(inputPath, outPath, options);
      converted = true;
      finalMeta = {
        ...meta,
        width: options.targetWidth,
        height: options.targetHeight,
        aspectRatio: options.targetWidth / options.targetHeight,
      };
    } else {
      outPath = inputPath;
    }

    const elapsed = Date.now() - start;
    console.log(
      `[${reqId}] process/shorts | original ${meta.width}x${meta.height} ${meta.durationSec}s | ` +
        `eligible=${validation.shortsEligible} converted=${converted} | ${elapsed}ms`,
    );

    const stat = fs.statSync(outPath);
    const stream = fs.createReadStream(outPath);
    const originalName = req.file.originalname || 'video';
    const ext = path.extname(originalName) || '.mp4';
    const base = path.basename(originalName, ext) || 'video';
    const safeBase = sanitizeFilename(base);
    const dispositionFilename = converted
      ? `shorts_${safeBase}${ext}`
      : `${safeBase}${ext}`;

    const cleanup = (): void => {
      try {
        rmDirRecursive(tmpDir);
      } catch {
        /* ignore */
      }
    };
    stream.on('end', cleanup);
    stream.on('error', (streamErr) => {
      console.error(`[${reqId}] stream error:`, (streamErr as Error).message);
      cleanup();
    });

    res.set({
      'Content-Type': 'video/mp4',
      'Content-Length': String(stat.size),
      'X-Video-Width': String(finalMeta.width),
      'X-Video-Height': String(finalMeta.height),
      'X-Video-DurationSec': String(finalMeta.durationSec),
      'X-Video-AspectRatio': String(finalMeta.aspectRatio),
      'X-Shorts-Eligible': String(validation.shortsEligible),
      'X-Converted': String(converted),
      'X-Conversion-Mode': conversionMode,
      'Content-Disposition': `attachment; filename="${dispositionFilename}"`,
    });
    stream.pipe(res);
    return;
  } catch (e) {
    const err = e as Error;
    try {
      rmDirRecursive(tmpDir);
    } catch {
      /* ignore */
    }
    if (err.message === 'FILE_NOT_VIDEO') {
      res.status(415).json({ error: 'UNSUPPORTED_MEDIA', message: 'File is not a video (invalid MIME type).' });
      return;
    }
    if (err.message.includes('ffprobe') || err.message.includes('exited with code')) {
      res.status(422).json({
        error: 'PROBE_FAILED',
        message: err.message,
      });
      return;
    }
    if (err.message.includes('ffmpeg') || err.message.includes('timeout')) {
      res.status(500).json({
        error: 'CONVERSION_FAILED',
        message: err.message,
      });
      return;
    }
    if (err.message.includes('exceeds') && err.message.includes('MB')) {
      res.status(400).json({ error: 'FILE_TOO_LARGE', message: err.message });
      return;
    }
    if (err.message.includes('Path must be under temp') || err.message.includes('Path traversal')) {
      res.status(400).json({ error: 'INVALID_PATH', message: err.message });
      return;
    }
    res.status(500).json({ error: 'UNKNOWN', message: err.message });
  }
}

/**
 * POST /inspect — metadata only, no conversion.
 */
export async function inspect(req: Request, res: Response): Promise<void> {
  const reqId = (req as Request & { requestId: string }).requestId;
  const tmpDir = (req as Request & { uniqueTmpDir: string }).uniqueTmpDir;
  const start = Date.now();

  try {
    if (!req.file) {
      rmDirRecursive(tmpDir);
      res.status(400).json({ error: 'NO_FILE', message: 'No file uploaded. Use multipart field "file".' });
      return;
    }

    assertFileSize(req.file.size);

    const options = parseProcessOptions((req.body as Record<string, unknown>) || {});
    const meta = await getVideoMetadata(req.file.path);
    const validation = validateShorts(meta, options);

    const elapsed = Date.now() - start;
    console.log(`[${reqId}] inspect | ${meta.width}x${meta.height} ${meta.durationSec}s | ${elapsed}ms`);

    res.status(200).json({
      width: meta.width,
      height: meta.height,
      durationSec: Math.round(meta.durationSec * 1000) / 1000,
      aspectRatio: Math.round(meta.aspectRatio * 1000) / 1000,
      shortsEligible: validation.shortsEligible,
      reason: validation.reasons,
    });
  } catch (e) {
    const err = e as Error;
    try {
      rmDirRecursive(tmpDir);
    } catch {
      /* ignore */
    }
    if (err.message === 'FILE_NOT_VIDEO') {
      res.status(415).json({ error: 'UNSUPPORTED_MEDIA', message: 'File is not a video (invalid MIME type).' });
      return;
    }
    if (err.message.includes('ffprobe') || err.message.includes('exited with code')) {
      res.status(422).json({ error: 'PROBE_FAILED', message: err.message });
      return;
    }
    if (err.message.includes('exceeds') && err.message.includes('MB')) {
      res.status(400).json({ error: 'FILE_TOO_LARGE', message: err.message });
      return;
    }
    res.status(500).json({ error: 'UNKNOWN', message: err.message });
  } finally {
    try {
      rmDirRecursive(tmpDir);
    } catch {
      /* ignore; may already be cleaned in catch */
    }
  }
}
