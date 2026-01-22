/**
 * Video Shorts Processing API — Express server.
 * GET /health, POST /process/shorts, POST /inspect.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import {
  processTmpMiddleware,
  upload,
  processShorts,
  inspect,
} from './routes/process';
import { rmDirRecursive } from './utils/tmp';
import { MAX_FILE_SIZE_BYTES } from './types';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '1kb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post(
  '/process/shorts',
  processTmpMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const tmpDir = (req as Request & { uniqueTmpDir?: string }).uniqueTmpDir;
        if (tmpDir) {
          try {
            rmDirRecursive(tmpDir);
          } catch {
            /* ignore */
          }
        }
        next(err);
        return;
      }
      next();
    });
  },
  processShorts,
);

app.post(
  '/inspect',
  processTmpMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const tmpDir = (req as Request & { uniqueTmpDir?: string }).uniqueTmpDir;
        if (tmpDir) {
          try {
            rmDirRecursive(tmpDir);
          } catch {
            /* ignore */
          }
        }
        next(err);
        return;
      }
      next();
    });
  },
  inspect,
);

interface MulterLimitsError {
  code?: string;
  message?: string;
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as Error & MulterLimitsError;
  const msg = e.message ?? 'Unknown error';

  if (msg === 'FILE_NOT_VIDEO') {
    res.status(415).json({
      error: 'UNSUPPORTED_MEDIA',
      message: 'File is not a video (invalid MIME type).',
    });
    return;
  }
  if (e.code === 'LIMIT_FILE_SIZE' || msg.includes('File too large')) {
    res.status(400).json({
      error: 'FILE_TOO_LARGE',
      message: `File size exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit.`,
    });
    return;
  }
  if (msg === 'missing uniqueTmpDir' || msg.includes('Unexpected field')) {
    res.status(400).json({
      error: 'BAD_REQUEST',
      message: msg === 'Unexpected field' ? 'Use multipart field "file" only.' : msg,
    });
    return;
  }

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: msg,
  });
});

app.listen(PORT, () => {
  console.log(`Video Shorts API listening on port ${PORT}`);
});
