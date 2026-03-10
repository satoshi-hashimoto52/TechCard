from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from pathlib import Path
from typing import Any, Dict
from PIL import Image, ImageOps
import io
import socket
import time
import uuid
import qrcode
import pillow_heif

router = APIRouter(prefix="/mobile-upload", tags=["mobile-upload"])

UPLOAD_DIR = Path("data/mobile_uploads")
MOBILE_UPLOADS: Dict[str, Dict[str, Any]] = {}

pillow_heif.register_heif_opener()


def _get_local_ip() -> str | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        if ip and not ip.startswith("127."):
            return ip
    except OSError:
        return None
    finally:
        sock.close()
    return None


def _build_base_url(
    request: Request,
    scheme_override: str | None = None,
    port_override: int | None = None,
) -> str:
    scheme = scheme_override or request.url.scheme or "http"
    host = _get_local_ip() or request.url.hostname or request.client.host or "localhost"
    port = port_override or request.url.port or 8000
    return f"{scheme}://{host}:{port}"


def _get_session(session_id: str) -> Dict[str, Any]:
    session = MOBILE_UPLOADS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _resize_cover(image: Image.Image, target_width: int, target_height: int) -> Image.Image:
    scale = max(target_width / image.width, target_height / image.height)
    resized = image.resize((int(image.width * scale), int(image.height * scale)))
    left = max((resized.width - target_width) // 2, 0)
    top = max((resized.height - target_height) // 2, 0)
    return resized.crop((left, top, left + target_width, top + target_height))


@router.post("/sessions")
def create_session(
    request: Request,
    scheme: str | None = Query(default=None),
    port: int | None = Query(default=None),
) -> Dict[str, str]:
    session_id = str(uuid.uuid4())
    base_url = _build_base_url(request, scheme_override=scheme, port_override=port)
    MOBILE_UPLOADS[session_id] = {
        "status": "waiting",
        "created_at": time.time(),
        "upload_count": 0,
        "updated_at": None,
        "filename": None,
        "file_path": None,
        "base_url": base_url,
        "error": None,
    }
    return {
        "session_id": session_id,
        "server_base_url": base_url,
        "upload_url": f"{base_url}/mobile-upload/{session_id}",
        "status_url": f"{base_url}/mobile-upload/{session_id}/status",
        "image_url": f"{base_url}/mobile-upload/{session_id}/image",
        "qr_url": f"{base_url}/mobile-upload/{session_id}/qr",
    }


@router.get("/{session_id}", response_class=HTMLResponse)
def mobile_upload_page(session_id: str) -> HTMLResponse:
    _get_session(session_id)
    html = f"""<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>名刺アップロード</title>
    <style>
      body {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
      }}
      .container {{
        max-width: 520px;
        margin: 0 auto;
        padding: 20px;
      }}
      .card {{
        background: white;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
      }}
      .frame {{
        margin: 16px auto;
        width: 100%;
        aspect-ratio: 1.6 / 1;
        border: 2px dashed #22c55e;
        border-radius: 12px;
        background: repeating-linear-gradient(
          135deg,
          rgba(34, 197, 94, 0.08),
          rgba(34, 197, 94, 0.08) 12px,
          rgba(34, 197, 94, 0.02) 12px,
          rgba(34, 197, 94, 0.02) 24px
        );
      }}
      .button {{
        display: block;
        width: 100%;
        background: #16a34a;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 14px 16px;
        font-size: 16px;
        font-weight: 600;
      }}
      .button:disabled {{
        opacity: 0.6;
      }}
      .status {{
        margin-top: 12px;
        font-size: 14px;
        color: #475569;
      }}
      .note {{
        font-size: 12px;
        color: #64748b;
        line-height: 1.5;
      }}
      .preview {{
        margin-top: 12px;
        width: 100%;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
      }}
      .video-wrap {{
        position: relative;
        margin: 16px auto 8px;
        width: 100%;
        aspect-ratio: 12 / 7;
        background: #0f172a;
        border-radius: 12px;
        overflow: hidden;
      }}
      video {{
        width: 100%;
        height: 100%;
        object-fit: cover;
      }}
      .overlay {{
        position: absolute;
        inset: 0;
        border: 2px solid #22c55e;
        border-radius: 12px;
        box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55);
        pointer-events: none;
      }}
      .controls {{
        display: grid;
        gap: 8px;
      }}
      .muted {{
        color: #94a3b8;
        font-size: 12px;
      }}
    </style>
  </head>
  <body>
    <div class="container">
      <h2>名刺を撮影してアップロード</h2>
      <div class="card">
        <div id="cameraWrap" class="video-wrap" hidden>
          <video id="video" playsinline muted></video>
          <div class="overlay"></div>
        </div>
        <p class="note">名刺が横長になるように、枠いっぱいで撮影してください。</p>
        <div class="controls">
          <button id="startButton" class="button" type="button">カメラ起動</button>
          <button id="captureButton" class="button" type="button" hidden>撮影してアップロード</button>
          <input id="fileInput" type="file" accept="image/*" capture="environment" hidden />
          <button id="fileButton" class="button" type="button">ファイルから選択</button>
          <span id="httpsNote" class="muted" hidden>HTTPS環境が必要です。HTTPの場合はファイル選択をご利用ください。</span>
        </div>
        <div id="status" class="status">待機中</div>
        <img id="preview" class="preview" alt="preview" hidden />
      </div>
    </div>
    <script>
      const fileInput = document.getElementById('fileInput');
      const fileButton = document.getElementById('fileButton');
      const startButton = document.getElementById('startButton');
      const captureButton = document.getElementById('captureButton');
      const statusEl = document.getElementById('status');
      const previewEl = document.getElementById('preview');
      const cameraWrap = document.getElementById('cameraWrap');
      const video = document.getElementById('video');
      const httpsNote = document.getElementById('httpsNote');
      const sessionId = "{session_id}";
      let stream = null;

      const setStatus = (message) => {{
        statusEl.textContent = message;
      }};

      const stopStream = () => {{
        if (!stream) return;
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }};

      const startCamera = async () => {{
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {{
          setStatus('カメラが利用できません。');
          return;
        }}
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {{
          httpsNote.hidden = false;
          setStatus('HTTPSが必要です。');
          return;
        }}
        try {{
          stream = await navigator.mediaDevices.getUserMedia({{
            video: {{
              facingMode: {{ ideal: 'environment' }},
              width: {{ ideal: 1920 }},
              height: {{ ideal: 1080 }},
            }},
            audio: false,
          }});
          video.srcObject = stream;
          await video.play();
          cameraWrap.hidden = false;
          captureButton.hidden = false;
          setStatus('カメラ起動中');
        }} catch (error) {{
          setStatus('カメラ起動に失敗しました。');
        }}
      }};

      const uploadBlob = async (blob, filename) => {{
        setStatus('アップロード中...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const formData = new FormData();
        formData.append('image', blob, filename);
        try {{
          const response = await fetch('/mobile-upload/' + sessionId + '/image', {{
            method: 'POST',
            body: formData,
            signal: controller.signal,
          }});
          if (!response.ok) {{
            let detail = '';
            try {{
              const data = await response.json();
              detail = data && data.detail ? ' (' + data.detail + ')' : '';
            }} catch (error) {{
              detail = '';
            }}
            throw new Error('upload failed' + detail);
          }}
          setStatus('アップロード完了。続けて撮影できます。');
        }} catch (error) {{
          const message = error && error.name === 'AbortError'
            ? 'アップロードがタイムアウトしました。通信状態をご確認ください。'
            : (error && error.message ? error.message : 'アップロードに失敗しました。');
          setStatus(message);
        }} finally {{
          clearTimeout(timeoutId);
          captureButton.disabled = false;
        }}
      }};

      fileButton.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {{
        const file = fileInput.files[0];
        if (!file) return;
        previewEl.src = URL.createObjectURL(file);
        previewEl.hidden = false;
        setStatus('アップロード中...');
        captureButton.disabled = true;
        await uploadBlob(file, file.name || 'mobile-upload.jpg');
      }});

      startButton.addEventListener('click', startCamera);

      captureButton.addEventListener('click', async () => {{
        if (!video.videoWidth || !video.videoHeight) {{
          setStatus('カメラが準備できていません。');
          return;
        }}
        captureButton.disabled = true;
        setStatus('画像処理中...');
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = video.videoWidth;
        fullCanvas.height = video.videoHeight;
        const fullCtx = fullCanvas.getContext('2d');
        if (!fullCtx) {{
          setStatus('撮影に失敗しました。');
          captureButton.disabled = false;
          return;
        }}
        fullCtx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
        let outputCanvas = fullCanvas;
        outputCanvas.toBlob(async (blob) => {{
          if (!blob) {{
            setStatus('撮影に失敗しました。');
            captureButton.disabled = false;
            return;
          }}
          previewEl.src = URL.createObjectURL(blob);
          previewEl.hidden = false;
          await uploadBlob(blob, 'mobile-capture.jpg');
        }}, 'image/jpeg', 0.92);
      }});
    </script>
  </body>
</html>
"""
    return HTMLResponse(html)


@router.get("/{session_id}/status")
def get_status(session_id: str) -> Dict[str, Any]:
    session = _get_session(session_id)
    base_url = session.get("base_url") or ""
    image_url = None
    if session["status"] == "done":
        image_url = f"{base_url}/mobile-upload/{session_id}/image"
    return {
        "status": session["status"],
        "filename": session.get("filename"),
        "image_url": image_url,
        "error": session.get("error"),
        "upload_count": session.get("upload_count", 0),
    }


@router.post("/{session_id}/image")
async def upload_image(
    session_id: str,
    file: UploadFile | None = File(None),
    image: UploadFile | None = File(None),
    crop: str = Form("1"),
) -> Dict[str, str | None]:
    session = _get_session(session_id)
    target_file = file or image
    if not target_file:
        session["status"] = "error"
        session["error"] = "Missing file"
        raise HTTPException(status_code=400, detail="Missing file")
    content = await target_file.read()
    if not content:
        session["status"] = "error"
        session["error"] = "Empty file"
        raise HTTPException(status_code=400, detail="Empty file")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_path = UPLOAD_DIR / f"{session_id}.png"
    try:
        pil_image = Image.open(io.BytesIO(content))
        pil_image = ImageOps.exif_transpose(pil_image)
        pil_image = pil_image.convert("RGB")
        pil_image = _resize_cover(pil_image, 1200, 700)
        pil_image.save(file_path, format="PNG")
    except Exception as exc:
        session["status"] = "error"
        session["error"] = str(exc) or "Invalid image"
        raise HTTPException(status_code=400, detail="Invalid image")

    session["status"] = "done"
    session["filename"] = target_file.filename
    session["file_path"] = str(file_path)
    session["upload_count"] = int(session.get("upload_count", 0)) + 1
    session["updated_at"] = time.time()
    session["error"] = None
    return {"status": "done", "filename": target_file.filename}


@router.get("/{session_id}/image")
def get_image(session_id: str) -> FileResponse:
    session = _get_session(session_id)
    if session["status"] != "done" or not session.get("file_path"):
        raise HTTPException(status_code=404, detail="Image not ready")
    return FileResponse(session["file_path"])


@router.get("/{session_id}/qr")
def get_qr(session_id: str, size: int = 240) -> Response:
    session = _get_session(session_id)
    base_url = session.get("base_url") or ""
    upload_url = f"{base_url}/mobile-upload/{session_id}"
    qr = qrcode.QRCode(border=2, box_size=10)
    qr.add_data(upload_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    if size and size > 0:
        img = img.resize((size, size))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")
