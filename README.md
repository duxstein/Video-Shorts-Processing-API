# Video Shorts Processing API

Production-ready API for processing videos into YouTube Shorts format. Accepts uploads, inspects metadata (width/height/duration), validates Shorts eligibility (portrait, 9:16, ≤60s), and converts non‑eligible videos to 1080×1920. Designed for **n8n** HTTP Request node integration.

---

## Tech Stack

- **Node.js 20+**
- **TypeScript**
- **Express** + **Multer** (multipart uploads)
- **FFmpeg** + **FFprobe** (metadata + conversion)
- **Docker** (FFmpeg in container)
- **Render**-ready

---

## Endpoints

### `GET /health`

Returns:

```json
{ "status": "ok" }
```

### `POST /process/shorts`

**Request:** `multipart/form-data`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | file | **required** | Video file |
| `mode` | `"pad"` \| `"blur"` | `"blur"` | Conversion mode |
| `targetWidth` | number | `1080` | Output width |
| `targetHeight` | number | `1920` | Output height |
| `maxDurationSec` | number | `60` | Max duration (seconds) |
| `tolerance` | number | `0.08` | Aspect-ratio tolerance |
| `forceConvert` | boolean | `false` | Convert even if already eligible |

**Response:** Binary video (`video/mp4`) with headers:

- `X-Video-Width`, `X-Video-Height`, `X-Video-DurationSec`, `X-Video-AspectRatio`
- `X-Shorts-Eligible`: `true` / `false`
- `X-Converted`: `true` / `false`
- `X-Conversion-Mode`: `pad` or `blur`
- `Content-Disposition`: `shorts_<name>.mp4` if converted, else `<name>.mp4`

If the video is already Shorts-eligible and `forceConvert` is `false`, the **original file** is returned unchanged.

### `POST /inspect`

**Request:** `multipart/form-data` with `file` (and optional `mode`, `targetWidth`, etc. for validation params).

**Response:** JSON metadata only (no conversion):

```json
{
  "width": 952,
  "height": 718,
  "durationSec": 48.033,
  "aspectRatio": 1.326,
  "shortsEligible": false,
  "reason": ["NOT_VERTICAL", "ASPECT_RATIO_MISMATCH"]
}
```

---

## Shorts Validation

- **Vertical:** `height > width`
- **Aspect:** `|width/height - 9/16| ≤ tolerance`
- **Duration:** `duration ≤ maxDurationSec`

`shortsEligible = durationOk && isVertical && aspectOk`. Conversion runs when `!shortsEligible` or `forceConvert=true`.

---

## Conversion Modes

| Mode | Description |
|------|-------------|
| **pad** | Scale to fit 1080×1920, pad with black bars (**faster** than blur) |
| **blur** | Blurred 1080×1920 background, overlay scaled video (default; slower on low‑CPU) |

Output: H.264 + AAC, MP4. FFmpeg runs with a configurable timeout (see **Environment**).

---

## Run Locally

```bash
npm install
npm run build
npm start
```

Override FFmpeg timeout (default 600 sec):

```bash
FFMPEG_TIMEOUT_SEC=900 npm start
```

Dev (watch):

```bash
npm run dev
```

Requires **FFmpeg** and **FFprobe** on `PATH` (e.g. via Docker).

---

## Docker

```bash
docker build -t shorts-api .
docker run -p 3000:3000 shorts-api
```

Override FFmpeg timeout (default 600 sec):

```bash
docker run -e FFMPEG_TIMEOUT_SEC=900 -p 3000:3000 shorts-api
```

---

## Deploy on Render

### 1. Create a **Web Service**

- **Connect** your repo (or use this repo).
- **Environment:** Docker.
- **Dockerfile path:** `./Dockerfile` (root).
- **Instance type:** Free or paid (recommended for video:至少 512MB RAM).

### 2. Environment

- `PORT`: Set by Render (usually `10000`). The app reads `process.env.PORT`.
- **`FFMPEG_TIMEOUT_SEC`** (optional): Max seconds before FFmpeg is killed. Default **600** (10 min). Use a higher value (e.g. `900`, `3600`) on slow or free-tier instances to avoid `CONVERSION_FAILED` timeouts. Clamped to 60–3600.
- Optional: `NODE_ENV=production` (default in Dockerfile).

### 3. Build & Deploy

- Render builds the Docker image (Node 20 + FFmpeg), runs `node dist/server.js`.
- Health check: `GET https://<your-service>.onrender.com/health` → `{ "status": "ok" }`.

### 4. n8n HTTP Request Node

- **Method:** `POST`
- **URL:** `https://<your-service>.onrender.com/process/shorts`
- **Body:** `form-data` (or “Send Binary Data” + “Binary Property” for file).
- **Send Body:** yes.
- **Form data:**
  - `file`: type **File**, value = binary from previous node (e.g. file picker / download).
  - Optional: `mode`, `targetWidth`, `targetHeight`, `maxDurationSec`, `tolerance`, `forceConvert`.
- **Response:** **File** (binary). Use “Response: File” / “Binary Property” to store the returned video (e.g. for YouTube upload).

---

## Error Responses (JSON)

| Status | `error` | Meaning |
|--------|---------|---------|
| 400 | `NO_FILE` | No `file` in multipart |
| 400 | `FILE_TOO_LARGE` | > 200MB |
| 415 | `UNSUPPORTED_MEDIA` | Non‑video MIME |
| 422 | `PROBE_FAILED` | FFprobe cannot read video |
| 500 | `CONVERSION_FAILED` | FFmpeg error / timeout |

---

## Project Layout

```
src/
  server.ts           # Express app, routes, error handling
  types.ts            # Shared types + defaults
  routes/
    process.ts        # /process/shorts, /inspect, multer, tmp middleware
  utils/
    tmp.ts            # Temp dirs, sanitization, cleanup
    ffprobe.ts        # Video metadata via FFprobe
    ffmpeg.ts         # Pad / blur conversion via FFmpeg
    validate.ts       # Shorts validation
Dockerfile            # Node 20 + FFmpeg, multi-stage
```

---

## License

MIT.
