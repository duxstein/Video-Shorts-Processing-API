You are a senior backend engineer. Build a production-ready **Video Shorts Processing API** that will be called by **n8n**. The API must accept a video upload (binary), inspect metadata (width/height/duration), decide whether it qualifies as a YouTube Short (portrait + ~9:16 + <= 60 sec), and if not, convert it into a valid Shorts format and return the converted video binary.

### Requirements

**Tech stack**

* Node.js 20+
* TypeScript
* Express (or Fastify if better)
* Use `multer` for multipart uploads
* Use FFmpeg + FFprobe (installed in container)
* Deployable on Render (Docker)
* Must work with n8n HTTP Request node

---

### Endpoints

#### 1) `GET /health`

Return JSON:

```json
{ "status": "ok" }
```

#### 2) `POST /process/shorts`

Accept multipart form-data:

* field name: `file` (the uploaded video)
* optional fields:

  * `mode`: `"pad"` | `"blur"` (default `"blur"`)
  * `targetWidth`: number default `1080`
  * `targetHeight`: number default `1920`
  * `maxDurationSec`: number default `60`
  * `tolerance`: number default `0.08` (aspect ratio tolerance)
  * `forceConvert`: boolean default `false` (convert even if already ok)

##### Response behavior

* If the video already matches Shorts requirements:

  * Do **not** reconvert unless `forceConvert=true`
  * Return original file as binary
  * Add headers describing metadata

* If it does not match Shorts requirements:

  * Convert video to correct Shorts format (1080x1920)
  * Keep audio
  * Use H.264 + AAC
  * Return converted binary

##### Response format

Return the video as binary with headers:

* `Content-Type`: `video/mp4`
* `X-Video-Width`: width
* `X-Video-Height`: height
* `X-Video-DurationSec`: duration seconds
* `X-Video-AspectRatio`: width/height float
* `X-Shorts-Eligible`: `true/false`
* `X-Converted`: `true/false`
* `X-Conversion-Mode`: `pad` or `blur`

Also include `Content-Disposition` with a filename like:

* `shorts_<originalfilename>.mp4` if converted
* `<originalfilename>` if unchanged

---

### Shorts Validation Logic

1. Read video metadata using ffprobe

   * width, height, duration
2. Determine:

   * `isVertical = height > width`
   * `aspect = width / height`
   * `targetAspect = 9/16 = 0.5625`
   * `aspectOk = abs(aspect - targetAspect) <= tolerance`
   * `durationOk = duration <= maxDurationSec`
3. Define `shortsEligible = durationOk && isVertical && aspectOk`
4. Convert if `!shortsEligible` (or forceConvert)

---

### Conversion Rules

Implement both conversion modes.

#### Mode A: `pad` (simple)

* Scale video down to fit inside 1080x1920
* Pad remaining area with black bars
  FFmpeg filter:
  `scale=1080:-2:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`

#### Mode B: `blur` (recommended default)

* Create blurred background filling 1080x1920
* Overlay the original video scaled to fit width=1080
  Use filter_complex pipeline:

1. background: scale to 1080x1920 with aspect_ratio=increase then crop, then blur
2. foreground: scale to 1080 preserving aspect ratio
3. overlay centered

Use:

* video codec: libx264
* preset: veryfast
* crf: 23
* audio codec: aac
* audio bitrate: 128k
* output: mp4

---

### File Handling / Temp Storage

* Store uploaded file temporarily in `/tmp`
* Use unique IDs (uuid)
* After processing, delete temp files
* Ensure concurrency safe
* Limit file size (example 200MB) and return proper error if exceeded

---

### Error Handling

Return JSON errors:

* 400 if no file uploaded
* 415 if file is not video (by mimeType)
* 422 if ffprobe cannot read video
* 500 for conversion failure

Example error JSON:

```json
{
  "error": "CONVERSION_FAILED",
  "message": "ffmpeg exited with code 1"
}
```

---

### Observability

* Console logs are fine
* Log:

  * requestId
  * original metadata
  * decision: eligible/converted
  * time taken
* Add a timeout guard for ffmpeg (kill process after e.g. 3 mins)

---

### Security

* Never execute arbitrary user input in shell
* Sanitize file paths
* Only accept multipart file upload

---

### Deliverables

Generate the full project including:

* `package.json`
* `tsconfig.json`
* `src/server.ts`
* `src/routes/process.ts`
* `src/utils/ffprobe.ts`
* `src/utils/ffmpeg.ts`
* `src/utils/tmp.ts`
* Dockerfile (ffmpeg installed)
* Render deploy instructions in README

The code should be complete, runnable, and clean.

---

### Bonus

Add a second endpoint:

#### `POST /inspect`

Uploads file and returns only metadata JSON (no conversion)

Example response:

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

Build this now. Make sure the API works end-to-end with n8n HTTP Request node expecting binary response.
Do not leave placeholders. Use real FFmpeg commands with `child_process.spawn` (NOT exec).
Return binary output correctly.
Include strict TypeScript types.

---

If you want, I can also give you the **n8n HTTP Request node configuration** (exact fields: “Send Binary Data”, “Binary Property”, “Response: File”, etc.) for connecting this API to YouTube upload.
