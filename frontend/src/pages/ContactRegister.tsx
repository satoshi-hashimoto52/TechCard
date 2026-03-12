import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import CardCropper from '../components/CardCropper';
import RoiEditor, { RoiField, RoiTemplate } from '../components/RoiEditor';

type OcrResult = {
  name: string | null;
  company: string | null;
  branch?: string | null;
  role?: string | null;
  email: string | null;
  phone: string | null;
  mobile?: string | null;
  address?: string | null;
  raw_text: string;
  filename: string;
};

type ContactRegisterResponse = {
  id: number;
};

type MobileUploadSession = {
  session_id: string;
  server_base_url: string;
  upload_url: string;
  status_url: string;
  image_url: string;
  qr_url: string;
};

type MobileUploadStatus = {
  status: 'waiting' | 'done' | 'error';
  filename?: string | null;
  image_url?: string | null;
  error?: string | null;
  upload_count?: number | null;
};

type TagOption = {
  id: number;
  name: string;
  type: 'tech' | 'event' | 'relation' | string;
};

type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step?: number };
  zoom?: { min: number; max: number; step?: number };
};

const ROI_STORAGE_KEY = 'techcard_roi_template';
const ROI_BASE_WIDTH = 1200;
const ROI_BASE_HEIGHT = 700;
const DEFAULT_ROI_TEMPLATE: RoiTemplate = {
  company: { x: 80, y: 60, w: 360, h: 55 },
  branch: { x: 460, y: 60, w: 260, h: 55 },
  name: { x: 80, y: 130, w: 260, h: 55 },
  dept: { x: 80, y: 200, w: 320, h: 55 },
  tel: { x: 80, y: 270, w: 240, h: 45 },
  mobile: { x: 340, y: 270, w: 240, h: 45 },
  mail: { x: 80, y: 330, w: 360, h: 50 },
  postal: { x: 80, y: 400, w: 180, h: 45 },
  address: { x: 270, y: 400, w: 520, h: 80 },
};

const ContactRegister: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [mode, setMode] = useState<'manual' | 'upload'>('manual');
  const [file, setFile] = useState<File | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardFilename, setCardFilename] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [detectedTags, setDetectedTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [initialTags, setInitialTags] = useState<string[]>([]);
  const [tagsTouched, setTagsTouched] = useState(false);
  const [customTag, setCustomTag] = useState('');
  const [availableTags, setAvailableTags] = useState<TagOption[]>([]);
  const [selectedTagOption, setSelectedTagOption] = useState('');
  const [newTagType, setNewTagType] = useState<'tech' | 'event' | 'relation'>('tech');
  const [manageTagId, setManageTagId] = useState<number | ''>('');
  const [manageTagType, setManageTagType] = useState<'tech' | 'event' | 'relation'>('tech');
  const todayString = (() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();
  const buildInitialForm = () => ({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    role: '',
    company: '',
    branch: '',
    postal_code: '',
    address: '',
    first_met_at: todayString,
    notes: '',
  });
  const [form, setForm] = useState(buildInitialForm);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isCropActive, setIsCropActive] = useState(false);
  const [roiTemplate, setRoiTemplate] = useState<RoiTemplate>(DEFAULT_ROI_TEMPLATE);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const isEdit = Boolean(id);
  const [focusDistance, setFocusDistance] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [focusMode, setFocusMode] = useState<string>('');
  const [cameraCapabilities, setCameraCapabilities] = useState<any>(null);
  const [cameraTrack, setCameraTrack] = useState<MediaStreamTrack | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [mobileSession, setMobileSession] = useState<MobileUploadSession | null>(null);
  const [mobileStatus, setMobileStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [mobileContinuous, setMobileContinuous] = useState(false);
  const [lastMobileUploadCount, setLastMobileUploadCount] = useState(0);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [mobileSessionLoading, setMobileSessionLoading] = useState(false);
  const [cropPointCount, setCropPointCount] = useState(0);
  const [autoCropPoints, setAutoCropPoints] = useState<{ x: number; y: number }[] | null>(null);
  const detectSeqRef = useRef(0);
  const isBlank = (value?: string) => !value || value.trim() === '';
  const targetWidth = ROI_BASE_WIDTH;
  const targetHeight = ROI_BASE_HEIGHT;
  const resetFormInputs = () => {
    setForm(buildInitialForm());
    setDetectedTags([]);
    setSelectedTags([]);
    setSelectedTagOption('');
    setCustomTag('');
    setTagsTouched(false);
    setManageTagId('');
    setManageTagType('tech');
    setNewTagType('tech');
    setOcrText(null);
    setSubmitError(null);
  };

  const handleChange = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [field]: event.target.value }));
  };

  const resizeImageFile = (inputFile: File) => {
    return new Promise<{ blob: Blob; file: File }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const offsetX = (targetWidth - drawWidth) / 2;
        const offsetY = (targetHeight - drawHeight) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context missing'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        canvas.toBlob(blob => {
          if (!blob) {
            reject(new Error('Failed to resize image'));
            return;
          }
          const normalizedName = inputFile.name.replace(/\.[^.]+$/, '') || 'upload';
          const file = new File([blob], `${normalizedName}-1200x700.png`, { type: 'image/png' });
          resolve({ blob, file });
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = URL.createObjectURL(inputFile);
    });
  };

  const readFileAsDataUrl = (inputFile: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(inputFile);
    });

  const fetchImageAsDataUrl = async (url: string) => {
    if (url.startsWith('data:')) return url;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`image fetch failed (${response.status})`);
      }
      const blob = await response.blob();
      return await readFileAsDataUrl(new File([blob], 'detect-source.png', { type: blob.type || 'image/png' }));
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const detectCardPointsFrom = async (url: string, inputFile?: File | null) => {
    const seq = ++detectSeqRef.current;
    try {
      const dataUrl = inputFile ? await readFileAsDataUrl(inputFile) : await fetchImageAsDataUrl(url);
      const response = await axios.post<{ points?: { x: number; y: number }[] }>(
        'http://localhost:8000/card/detect',
        { image: dataUrl },
        { timeout: 15000 },
      );
      if (seq !== detectSeqRef.current) return;
      const points = response.data?.points;
      if (Array.isArray(points) && points.length === 4) {
        setAutoCropPoints(points.map(point => ({ x: Number(point.x), y: Number(point.y) })));
      }
    } catch (error) {
      if (seq === detectSeqRef.current) {
        setAutoCropPoints(null);
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    if (!nextFile) return;
    resizeImageFile(nextFile)
      .then(({ blob, file }) => {
        setFile(file);
        const url = URL.createObjectURL(blob);
        setOriginalImage(url);
        setCroppedImage(null);
        setSelectedImage(url);
        setIsCropActive(true);
        setOcrText(null);
        setCardFilename(file.name);
        setAutoCropPoints(null);
        detectCardPointsFrom(url, file);
      })
      .catch(() => {
        const url = URL.createObjectURL(nextFile);
        setOriginalImage(url);
        setCroppedImage(null);
        setSelectedImage(url);
        setIsCropActive(true);
        setOcrText(null);
        setCardFilename(nextFile.name);
        setAutoCropPoints(null);
        detectCardPointsFrom(url, nextFile);
      });
  };

  const startCamera = async (deviceId?: string) => {
    try {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
      const targetDeviceId = deviceId || selectedDeviceId;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
          ...(targetDeviceId ? { deviceId: { exact: targetDeviceId } } : {}),
        },
      });
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      console.log('Camera capabilities:', capabilities);
      setCameraTrack(track);
      setCameraCapabilities(capabilities);
      if (capabilities.focusMode && capabilities.focusMode.length > 0) {
        const preferred = capabilities.focusMode.includes('continuous')
          ? 'continuous'
          : capabilities.focusMode[0];
        setFocusMode(preferred);
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: preferred } as MediaTrackConstraintSet],
          });
        } catch {
          // ignore unsupported mode
        }
      }
      if (capabilities.focusDistance) {
        setFocusDistance(capabilities.focusDistance.min ?? 0);
      }
      if (capabilities.zoom) {
        setZoomLevel(capabilities.zoom.min ?? 1);
      }
      setCameraStream(stream);
      setIsCameraActive(true);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      setVideoDevices(videoInputs);
    } catch (error) {
      console.error('Camera access error', error);
    }
  };

  const stopCamera = () => {
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(track => track.stop());
    setCameraStream(null);
    setIsCameraActive(false);
    setCameraTrack(null);
    setCameraCapabilities(null);
    setFocusMode('');
  };

  const captureImage = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const capturedFile = new File([blob], 'camera-business-card.png', { type: 'image/png' });
      resizeImageFile(capturedFile)
        .then(({ blob: resizedBlob, file }) => {
          const url = URL.createObjectURL(resizedBlob);
          setFile(file);
          setOriginalImage(url);
          setCroppedImage(null);
          setSelectedImage(url);
          setIsCropActive(true);
          setOcrText(null);
          setCardFilename(file.name);
          setAutoCropPoints(null);
          detectCardPointsFrom(url, file);
          stopCamera();
        })
        .catch(() => {
          const url = URL.createObjectURL(capturedFile);
          setFile(capturedFile);
          setOriginalImage(url);
          setCroppedImage(null);
          setSelectedImage(url);
          setIsCropActive(true);
          setOcrText(null);
          setCardFilename(capturedFile.name);
          setAutoCropPoints(null);
          detectCardPointsFrom(url, capturedFile);
          stopCamera();
        });
    });
  };

  const extractCompanyCandidate = (text: string): string | null => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    const match = cleaned.match(/(株式会社|有限会社|合同会社)[^\s]{0,20}/);
    if (match) return match[0];
    const candidates = cleaned.split(/[|/]/).map(item => item.trim()).filter(Boolean);
    const keywordMatch = candidates.find(item =>
      /(Inc|Ltd|LLC|Co\.|Corp)/i.test(item),
    );
    if (keywordMatch) return keywordMatch;
    const lines = cleaned.split(/[\n]/).map(item => item.trim()).filter(Boolean);
    const first = lines[0] || null;
    if (first && first.length > 40) return null;
    return first;
  };

  const normalizeCompanyName = (text: string) => {
    if (!text) return text;
    let normalized = text.replace(/\u3000/g, ' ').trim();
    normalized = normalized.replace(/\s+/g, ' ');
    normalized = normalized.replace(/株\s*式\s*会\s*社/g, '株式会社');
    normalized = normalized.replace(/有\s*限\s*会\s*社/g, '有限会社');
    normalized = normalized.replace(/合\s*同\s*会\s*社/g, '合同会社');
    normalized = normalized.replace(/\s*(株式会社|有限会社|合同会社|（株）|\(株\)|㈱)\s+/g, '$1');
    normalized = normalized.replace(/\s+((株式会社|有限会社|合同会社|（株）|\(株\)|㈱))\s*/g, '$1');
    return normalized.trim();
  };

  const normalizeEmail = (text: string) => {
    if (!text) return text;
    const cleaned = text.replace(/＠/g, '@').replace(/[．。]/g, '.').replace(/\s+/g, '').trim();
    if (!cleaned.includes('@')) return cleaned;
    const [local, domainRaw] = cleaned.split('@');
    const domain = domainRaw.replace(/\.\.+/g, '.');
    if (domain.includes('.')) return `${local}@${domain}`;
    const lower = domain.toLowerCase();
    const jpSuffixes = ['cojp', 'nejp', 'orjp', 'acjp', 'gojp', 'edjp', 'lgjp'];
    for (const suffix of jpSuffixes) {
      if (lower.endsWith(suffix) && domain.length > suffix.length) {
        const base = domain.slice(0, -suffix.length);
        return `${local}@${base}.${suffix.slice(0, 2)}.${suffix.slice(2)}`;
      }
    }
    const genericSuffixes = ['com', 'net', 'org', 'jp', 'co', 'io'];
    for (const suffix of genericSuffixes) {
      if (lower.endsWith(suffix) && domain.length > suffix.length) {
        const base = domain.slice(0, -suffix.length);
        return `${local}@${base}.${suffix}`;
      }
    }
    return `${local}@${domain}`;
  };

  const normalizePersonName = (text: string) => {
    if (!text) return text;
    let normalized = text.replace(/\u3000/g, ' ').trim();
    normalized = normalized.replace(/\s+/g, ' ');
    if (normalized.includes(' ')) {
      return normalized.split(' ').filter(Boolean).join(' ');
    }
    if (/^[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]+$/.test(normalized)) {
      const length = normalized.length;
      if (length >= 2 && length <= 6) {
        let splitAt = 1;
        if (length === 4) splitAt = 2;
        if (length === 5) splitAt = 2;
        if (length === 6) splitAt = 3;
        return `${normalized.slice(0, splitAt)} ${normalized.slice(splitAt)}`;
      }
    }
    return normalized;
  };

  const normalizeRole = (text: string) => {
    if (!text) return text;
    return text.replace(/\s+/g, ' ').trim();
  };

  const parsePostalAndAddress = (text: string) => {
    const match = text.match(/〒?\s*(\d{3})[-\s]?(\d{4})/);
    if (!match) {
      return { postalCode: '', address: text.trim() };
    }
    const postalCode = `${match[1]}-${match[2]}`;
    const address = text.replace(match[0], '').replace(/\s+/g, ' ').trim();
    return { postalCode, address };
  };

  const normalizePostalCode = (text: string) => {
    const match = text.match(/(\d{3})[-\s]?(\d{4})/);
    if (!match) return text.trim();
    return `${match[1]}-${match[2]}`;
  };

  const dataUrlToFile = (dataUrl: string, filename: string) => {
    const [meta, base64] = dataUrl.split(',');
    const mimeMatch = meta.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
  };

  const applyOcrField = (field: RoiField, text: string) => {
    setForm(prev => {
      const next = { ...prev };
      if (field === 'name' && isBlank(prev.name)) {
        next.name = normalizePersonName(text);
      }
      if (field === 'company' && isBlank(prev.company)) {
        next.company = normalizeCompanyName(text);
      }
      if (field === 'branch' && isBlank(prev.branch)) {
        next.branch = text.trim();
      }
      if (field === 'dept' && isBlank(prev.role)) {
        next.role = normalizeRole(text);
      }
      if (field === 'mail' && isBlank(prev.email)) {
        next.email = normalizeEmail(text);
      }
      if (field === 'tel' && isBlank(prev.phone)) {
        next.phone = text.trim();
      }
      if (field === 'mobile' && isBlank(prev.mobile)) {
        next.mobile = text.trim();
      }
      if (field === 'postal' && isBlank(prev.postal_code)) {
        next.postal_code = normalizePostalCode(text);
      }
      if (field === 'address' && (isBlank(prev.address) || isBlank(prev.postal_code))) {
        const parsed = parsePostalAndAddress(text);
        if (isBlank(prev.postal_code) && parsed.postalCode) {
          next.postal_code = parsed.postalCode;
        }
        if (isBlank(prev.address) && parsed.address) {
          next.address = parsed.address;
        }
      }
      return next;
    });
  };

  useEffect(() => {
    axios.get<TagOption[]>('http://localhost:8000/tags')
      .then(response => {
        const normalizeType = (value?: string) => {
          if (!value) return 'tech';
          if (value === 'technology') return 'tech';
          if (value === 'event') return 'event';
          return value;
        };
        const tags = response.data
          .filter(tag => tag.name)
          .map(tag => ({ ...tag, type: normalizeType(tag.type) }));
        tags.sort((a, b) => {
          const typeOrder = (value: string) => {
            if (value === 'tech') return 0;
            if (value === 'event') return 1;
            if (value === 'relation') return 2;
            return 3;
          };
          const diff = typeOrder(a.type) - typeOrder(b.type);
          if (diff !== 0) return diff;
          return a.name.localeCompare(b.name, 'ja');
        });
        setAvailableTags(tags);
      })
      .catch(() => setAvailableTags([]));
  }, []);

  useEffect(() => {
    if (!manageTagId) return;
    const target = availableTags.find(tag => tag.id === manageTagId);
    if (!target) return;
    if (target.type === 'relation') {
      setManageTagType('relation');
    } else if (target.type === 'event') {
      setManageTagType('event');
    } else {
      setManageTagType('tech');
    }
  }, [manageTagId, availableTags]);

  useEffect(() => {
    if (!isEdit || !id) return;
    setMode('manual');
    axios.get(`http://localhost:8000/contacts/${id}`).then(response => {
      const data = response.data;
      setForm({
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        mobile: data.mobile || '',
        role: data.role || '',
        company: data.company?.name || '',
        branch: data.branch || '',
        postal_code: data.postal_code || '',
        address: data.address || '',
        first_met_at: data.first_met_at || '',
        notes: data.notes || '',
      });
      setSelectedTags((data.tags || []).map((tag: { name: string }) => tag.name));
      setInitialTags((data.tags || []).map((tag: { name: string }) => tag.name));
      setTagsTouched(false);
      setDetectedTags([]);
      setCustomTag('');
    });
  }, [isEdit, id]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (!cameraStream) return;
    videoRef.current.srcObject = cameraStream;
    videoRef.current.play().catch(() => {});
  }, [cameraStream]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setVideoDevices(videoInputs);
        if (!selectedDeviceId && videoInputs.length > 0) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    if (!flashMessage) return;
    const timer = window.setTimeout(() => {
      setFlashMessage(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [flashMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(ROI_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const fields: RoiField[] = ['company', 'branch', 'name', 'dept', 'tel', 'mobile', 'mail', 'postal', 'address'];
      const next = { ...DEFAULT_ROI_TEMPLATE } as RoiTemplate;
      for (const field of fields) {
        const item = parsed[field];
        if (!item) throw new Error('invalid roi template');
        const x = Number(item.x);
        const y = Number(item.y);
        const w = Number(item.w);
        const h = Number(item.h);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
          throw new Error('invalid roi template values');
        }
        next[field] = { x, y, w, h };
      }
      setRoiTemplate(next);
    } catch {
      setRoiTemplate(DEFAULT_ROI_TEMPLATE);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify(roiTemplate));
  }, [roiTemplate]);

  const resetRoiTemplate = () => {
    setRoiTemplate(DEFAULT_ROI_TEMPLATE);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ROI_STORAGE_KEY, JSON.stringify(DEFAULT_ROI_TEMPLATE));
    }
  };

  const runOcrFromRoi = async () => {
    if (!selectedImage) return;
    if (isOcrRunning) return;
    setIsOcrRunning(true);
    setSubmitError(null);
    setDetectedTags([]);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = selectedImage;
      });
      const scaleX = img.width / ROI_BASE_WIDTH;
      const scaleY = img.height / ROI_BASE_HEIGHT;
      const results: { field: RoiField; text: string }[] = [];
      const fields: RoiField[] = ['company', 'branch', 'name', 'dept', 'tel', 'mobile', 'mail', 'postal', 'address'];
      for (const field of fields) {
        const roi = roiTemplate[field];
        const cropX = Math.max(0, Math.round(roi.x * scaleX));
        const cropY = Math.max(0, Math.round(roi.y * scaleY));
        const cropW = Math.max(1, Math.round(roi.w * scaleX));
        const cropH = Math.max(1, Math.round(roi.h * scaleY));
        const canvas = document.createElement('canvas');
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        const dataUrl = canvas.toDataURL('image/png');
        const file = dataUrlToFile(dataUrl, `roi-${field}.png`);
        const formData = new FormData();
        formData.append('field', field);
        formData.append('image', file);
        const response = await axios.post<{ field: RoiField; text: string }>(
          'http://localhost:8000/cards/ocr-region',
          formData,
        );
        if (response.data?.text) {
          results.push({ field, text: response.data.text });
        }
      }
      const rawText = results.map(item => item.text).join('\n');
      setOcrText(rawText || null);
      results.forEach(item => applyOcrField(item.field, item.text));
      if (rawText) {
        try {
          const tagsResponse = await axios.post<{ tags: string[] }>('http://localhost:8000/tags/extract', { text: rawText });
          if (tagsResponse.data?.tags) {
            setDetectedTags(tagsResponse.data.tags);
          }
        } catch {
          // ignore tag extraction errors
        }
      }
    } catch (error) {
      console.error('ROI OCR failed', error);
      setSubmitError('OCRに失敗しました。');
    } finally {
      setIsOcrRunning(false);
    }
  };


  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || isOcrRunning) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const tagsPayload = tagsTouched ? selectedTags : initialTags;
    const normalizeTagType = (value?: string) => {
      if (!value) return 'tech';
      if (value === 'technology') return 'tech';
      return value;
    };
    const tagItems = tagsPayload.map(name => {
      const found = availableTags.find(tag => tag.name === name);
      return {
        name,
        type: normalizeTagType(found?.type),
      };
    });
    const payload = {
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      role: form.role || null,
      mobile: form.mobile || null,
      postal_code: form.postal_code || null,
      address: form.address || null,
      branch: form.branch || null,
      company_name: form.company || null,
      first_met_at: form.first_met_at || null,
      tags: tagsPayload,
      tag_items: tagItems,
      notes: form.notes || null,
      card_filename: cardFilename,
      ocr_text: ocrText,
    };
    const keepFieldsForContinuous = () => {
      setForm(prev => ({
        ...prev,
        name: '',
        email: '',
        mobile: '',
        role: '',
        branch: '',
        notes: '',
        first_met_at: prev.first_met_at,
        company: prev.company,
        phone: prev.phone,
        postal_code: prev.postal_code,
        address: prev.address,
      }));
    };
    const shouldStayOnRegister = !isEdit && mode === 'upload' && mobileContinuous;
    try {
      if (isEdit && id) {
        const response = await axios.put<ContactRegisterResponse>(`http://localhost:8000/contacts/${id}/register`, payload);
        navigate(`/contacts/${response.data.id}`, { state: { flash: '更新しました。' } });
      } else {
        const response = await axios.post<ContactRegisterResponse>('http://localhost:8000/contacts/register', payload);
        if (shouldStayOnRegister) {
          setFlashMessage('登録しました。');
          keepFieldsForContinuous();
        } else {
          navigate(`/contacts/${response.data.id}`, { state: { flash: '登録しました。' } });
        }
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const status = error?.response?.status;
      if (status === 409 && !isEdit) {
        const existingId = typeof detail === 'object' ? detail.existing_contact_id : null;
        const message = typeof detail === 'object' ? detail.message : detail;
        if (existingId) {
          const confirmed = window.confirm(`${message || '同名・同会社の連絡先が存在します。'}\n上書きしますか？`);
          if (confirmed) {
            const response = await axios.put<ContactRegisterResponse>(`http://localhost:8000/contacts/${existingId}/register`, payload);
            if (shouldStayOnRegister) {
              setFlashMessage('上書きしました。');
              keepFieldsForContinuous();
            } else {
              navigate(`/contacts/${response.data.id}`, { state: { flash: '上書きしました。' } });
            }
            return;
          }
          setSubmitError('登録をキャンセルしました。');
          return;
        }
        setSubmitError(message || '同名・同会社の連絡先が存在します。');
        return;
      }
      if (status === 409) {
        setSubmitError(detail?.message || detail || '既に同名の連絡先が存在します。');
      } else {
        setSubmitError(detail?.message || detail || '登録に失敗しました。');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const startMobileUploadSession = async () => {
    if (mobileSessionLoading) return;
    setMobileSessionLoading(true);
    setMobileError(null);
    try {
      const scheme = 'https';
      const port = 8443;
      const baseUrl = `https://localhost:8443`;
      const response = await axios.post<MobileUploadSession>(
        `${baseUrl}/mobile-upload/sessions?scheme=${scheme}&port=${port}`,
        undefined,
        { timeout: 8000 },
      );
      setMobileSession(response.data);
      setMobileStatus('waiting');
      setLastMobileUploadCount(0);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
        if (detail) {
          setMobileError(`QRの生成に失敗しました: ${detail}`);
          return;
        }
        if (error.message) {
          setMobileError(`QRの生成に失敗しました: ${error.message}`);
          return;
        }
      }
      setMobileError('QRの生成に失敗しました。');
    } finally {
      setMobileSessionLoading(false);
    }
  };

  const closeMobileUploadSession = () => {
    setMobileSession(null);
    setMobileStatus('idle');
    setMobileError(null);
    setLastMobileUploadCount(0);
  };

  useEffect(() => {
    if (!mobileSession) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await axios.get<MobileUploadStatus>(mobileSession.status_url);
        if (stopped) return;
        setMobileStatus(response.data.status);
        if (response.data.status === 'done' && response.data.image_url) {
          const uploadCount = response.data.upload_count ?? 0;
          if (!mobileContinuous || uploadCount > lastMobileUploadCount) {
            const cacheBusted = `${response.data.image_url}?t=${Date.now()}`;
            setOriginalImage(cacheBusted);
            setCroppedImage(null);
            setSelectedImage(cacheBusted);
            setIsCropActive(true);
            setOcrText(null);
            setCardFilename(response.data.filename || 'mobile-upload.png');
            setLastMobileUploadCount(uploadCount);
            setAutoCropPoints(null);
            detectCardPointsFrom(cacheBusted, null);
          }
          if (!mobileContinuous) {
            stopped = true;
          }
        }
        if (response.data.status === 'error') {
          setMobileError(response.data.error || 'アップロードでエラーが発生しました。');
          stopped = true;
        }
      } catch (error) {
        if (!stopped) {
          setMobileError('アップロード状況の取得に失敗しました。');
        }
      }
    };
    const timer = window.setInterval(poll, 1500);
    poll().catch(() => undefined);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [mobileSession?.session_id, mobileContinuous, lastMobileUploadCount]);

  const canRunOcr = mode === 'upload' && !isCropActive && Boolean(selectedImage);

  const uploadColumn = mode === 'upload' ? (
    <div className="space-y-4">
      {isCameraActive && (
        <div className="relative">
          <div className="relative w-full max-w-4xl mx-auto">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full max-w-4xl rounded bg-black"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-[85%] aspect-[12/7] border-2 border-emerald-400 rounded-md shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          </div>
          <div className="mt-4 max-w-4xl mx-auto border rounded bg-gray-50 p-3 space-y-3">
            <h3 className="text-sm font-semibold">Camera Controls</h3>
            <p className="text-xs text-gray-600">
              Focus control availability depends on the camera.
            </p>
            {cameraCapabilities?.focusMode && cameraStream && (
              <div className="flex items-center gap-3">
                <label className="text-xs w-24">Focus Mode</label>
                <select
                  value={focusMode}
                  onChange={async e => {
                    const value = e.target.value;
                    setFocusMode(value);
                    try {
                      const track = cameraStream.getVideoTracks()[0];
                      await track.applyConstraints({
                        advanced: [{ focusMode: value } as MediaTrackConstraintSet],
                      });
                    } catch {
                      // ignore unsupported mode
                    }
                  }}
                  className="flex-1 border rounded px-2 py-1 text-xs"
                >
                  {cameraCapabilities.focusMode.map((mode: string) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </div>
            )}
            {cameraCapabilities?.focusDistance && cameraStream && (
              <div className="flex items-center gap-3">
                <label className="text-xs w-24">Focus</label>
                <input
                  type="range"
                  min={cameraCapabilities.focusDistance.min}
                  max={cameraCapabilities.focusDistance.max}
                  step={cameraCapabilities.focusDistance.step || 1}
                  value={focusDistance}
                  onChange={async e => {
                    const value = Number(e.target.value);
                    setFocusDistance(value);
                    try {
                      const track = cameraStream.getVideoTracks()[0];
                      await track.applyConstraints({
                        advanced: [{ focusDistance: value } as MediaTrackConstraintSet],
                      });
                    } catch {
                      // ignore unsupported constraint
                    }
                  }}
                  className="flex-1"
                />
                <span className="text-xs tabular-nums w-12 text-right">{focusDistance}</span>
              </div>
            )}
            {cameraCapabilities?.zoom && cameraStream && (
              <div className="flex items-center gap-3">
                <label className="text-xs w-24">Zoom</label>
                <input
                  type="range"
                  min={cameraCapabilities.zoom.min}
                  max={cameraCapabilities.zoom.max}
                  step={cameraCapabilities.zoom.step || 0.1}
                  value={zoomLevel}
                  onChange={async e => {
                    const value = Number(e.target.value);
                    setZoomLevel(value);
                    try {
                      const track = cameraStream.getVideoTracks()[0];
                      await track.applyConstraints({
                        advanced: [{ zoom: value } as MediaTrackConstraintSet],
                      });
                    } catch {
                      // ignore unsupported constraint
                    }
                  }}
                  className="flex-1"
                />
                <span className="text-xs tabular-nums w-12 text-right">{zoomLevel.toFixed(1)}</span>
              </div>
            )}
            <pre className="text-xs bg-black text-green-400 p-2 rounded overflow-auto">
              {JSON.stringify(cameraCapabilities, null, 2)}
            </pre>
          </div>
          <div className="flex gap-3 justify-center mt-4">
            <button
              type="button"
              onClick={captureImage}
              className="bg-green-600 text-white px-4 py-2 rounded"
            >
              Capture Card
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="bg-gray-600 text-white px-4 py-2 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {originalImage && isCropActive && (
        <div className="bg-gray-50 border border-gray-200 rounded p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 mb-2">
            <span className="text-sm font-semibold text-gray-800">名刺手動クロップ</span>
            <span>4点をクリックして指定（ドラッグで調整可）</span>
            <span className="ml-auto tabular-nums">{cropPointCount}/4</span>
          </div>
          <CardCropper
            imageUrl={originalImage}
            imageFile={file}
            onCropped={setCroppedImage}
            onPointCountChange={setCropPointCount}
            initialPoints={autoCropPoints}
            extraActions={(
              <>
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded border bg-white"
                  onClick={() => {
                    setSelectedImage(originalImage);
                    setDetectedTags([]);
                    setOcrText(null);
                    setIsCropActive(false);
                  }}
                >
                  元画像を使用
                </button>
                <button
                  type="button"
                  className="px-3 py-2 text-sm rounded border bg-white disabled:opacity-50"
                  disabled={!croppedImage}
                  onClick={() => {
                    if (!croppedImage) return;
                    setSelectedImage(croppedImage);
                    setDetectedTags([]);
                    setOcrText(null);
                    setIsCropActive(false);
                  }}
                >
                  クロップ後を使用
                </button>
                {cardFilename && (
                  <span className="ml-auto text-xs text-gray-500">Loaded: {cardFilename}</span>
                )}
              </>
            )}
          />
        </div>
      )}

      {selectedImage && !isCropActive && (
        <RoiEditor
          imageUrl={selectedImage}
          template={roiTemplate}
          onChange={setRoiTemplate}
          baseWidth={ROI_BASE_WIDTH}
          baseHeight={ROI_BASE_HEIGHT}
        />
      )}
      {!originalImage && !selectedImage && !isCropActive && (
        <div className="border rounded bg-gray-50 text-xs text-gray-400 flex items-center justify-center aspect-[12/7]">
          画像のプレビュー領域
        </div>
      )}

      <div className="border border-dashed border-gray-300 rounded p-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={mobileSession ? closeMobileUploadSession : startMobileUploadSession}
              disabled={mobileSessionLoading}
              className={`px-4 py-2 rounded cursor-pointer relative z-10 disabled:opacity-50 disabled:cursor-not-allowed ${
                mobileSession ? 'bg-gray-700 text-white' : 'bg-emerald-600 text-white'
              }`}
            >
              {mobileSessionLoading
                ? 'QR生成中...'
                : mobileSession
                  ? 'QRを閉じる'
                  : 'スマホで撮影（QR表示）'}
            </button>
            <span className="text-xs text-gray-500">同一Wi-Fi接続が必要です。OCRは空欄のみ取得します。</span>
            <label
              className={`text-xs font-semibold flex items-center gap-2 border rounded px-2 py-1 transition-colors ${
                mobileContinuous
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-400'
                  : 'bg-amber-50 text-amber-700 border-amber-400'
              }`}
            >
              <input
                type="checkbox"
                checked={mobileContinuous}
                onChange={event => setMobileContinuous(event.target.checked)}
              />
              連続登録モード
            </label>
            <div className="ml-auto">
              <input
                type="file"
                onChange={handleFileChange}
                className="block"
              />
            </div>
          </div>
          {mobileError && (
            <p className="mt-2 text-sm text-red-600">{mobileError}</p>
          )}
          {mobileSession && (
            <div className="mt-3 flex flex-col md:flex-row gap-4">
              <div className="bg-white border rounded p-3 w-fit">
                <img
                  src={mobileSession.qr_url}
                  alt="QR"
                  className="w-44 h-44"
                />
              </div>
              <div className="text-sm text-gray-600 space-y-2">
                <p>iPhoneでQRを読み取り、名刺を撮影してアップロードしてください。</p>
                <p className="text-xs text-gray-500 break-all">URL: {mobileSession.upload_url}</p>
                <p className="text-xs text-gray-500">
                  状態: {mobileStatus === 'waiting' ? '待機中' : mobileStatus === 'done' ? '完了' : mobileStatus === 'error' ? 'エラー' : '準備中'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-3 py-2 text-sm rounded bg-emerald-600 text-white disabled:opacity-50"
          onClick={runOcrFromRoi}
          disabled={!canRunOcr || isOcrRunning}
        >
          {isOcrRunning ? 'OCR処理中...' : 'OCR実行'}
        </button>
        <button
          type="button"
          className="px-3 py-2 text-sm rounded border bg-white disabled:opacity-50"
          onClick={resetRoiTemplate}
          disabled={!selectedImage}
        >
          ROIをデフォルトに戻す
        </button>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded p-4">
        <h2 className="text-sm font-semibold mb-3">検出された技術</h2>
        {detectedTags.length === 0 ? (
          <p className="text-sm text-gray-500">技術はまだ検出されていません。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {detectedTags.map(tag => {
              const added = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    if (added) return;
                    setTagsTouched(true);
                    setSelectedTags(prev => [...prev, tag]);
                  }}
                  className={`px-2 py-1 rounded text-sm border ${
                    added
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {tag} {added ? '✓' : 'Add'}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  ) : null;

  const formColumn = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {submitError && (
        <div className="text-sm text-red-600">{submitError}</div>
      )}
        <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">会社 / 支店(Office)</label>
            <div className="flex flex-1 gap-4">
              <input
                type="text"
                value={form.company}
                onChange={handleChange('company')}
                className="flex-[4] border rounded px-3 py-2"
                placeholder="会社"
              />
              <input
                type="text"
                value={form.branch}
                onChange={handleChange('branch')}
                className="flex-[6] border rounded px-3 py-2"
                placeholder="支店 / Office"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">氏名 / 初回</label>
            <div className="flex flex-1 gap-4">
              <input
                type="text"
                value={form.name}
                onChange={handleChange('name')}
                className="flex-[7] border rounded px-3 py-2"
                required
                placeholder="氏名"
              />
              <input
                type="date"
                value={form.first_met_at}
                onChange={handleChange('first_met_at')}
                className="flex-[3] border rounded px-3 py-2"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">役職・部署</label>
            <input
              type="text"
              value={form.role}
              onChange={handleChange('role')}
              className="flex-1 border rounded px-3 py-2"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">電話 / 携帯</label>
            <div className="flex flex-1 gap-4">
              <input
                type="tel"
                value={form.phone}
                onChange={handleChange('phone')}
                className="flex-1 border rounded px-3 py-2"
                placeholder="電話"
              />
              <input
                type="text"
                value={form.mobile}
                onChange={handleChange('mobile')}
                className="flex-1 border rounded px-3 py-2"
                placeholder="携帯"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">メール</label>
            <input
              type="email"
              value={form.email}
              onChange={handleChange('email')}
              className="flex-1 border rounded px-3 py-2"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">郵便番号 / 住所</label>
            <div className="flex flex-1 gap-4">
              <input
                type="text"
                value={form.postal_code}
                onChange={handleChange('postal_code')}
                className="flex-[2] border rounded px-3 py-2"
                placeholder="123-4567"
              />
              <input
                type="text"
                value={form.address}
                onChange={handleChange('address')}
                className="flex-[8] border rounded px-3 py-2"
                placeholder="住所"
              />
            </div>
          </div>
          <div className="flex items-start gap-4">
            <label className="w-32 text-sm font-medium pt-2">タグ</label>
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap gap-2">
                {selectedTags.map(tag => {
                  const tagType = availableTags.find(item => item.name === tag)?.type;
                  const styleClass = tagType === 'relation'
                    ? 'bg-emerald-100 text-emerald-800'
                    : tagType === 'event'
                    ? 'bg-orange-100 text-orange-800'
                    : 'bg-blue-100 text-blue-800';
                  return (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-2 px-2 py-1 rounded text-sm ${styleClass}`}
                    >
                      {tag}
                    <button
                      type="button"
                      onClick={() => {
                        setTagsTouched(true);
                        setSelectedTags(prev => prev.filter(item => item !== tag));
                      }}
                      className={
                        tagType === 'relation'
                          ? 'text-emerald-800 hover:text-emerald-900'
                          : tagType === 'event'
                          ? 'text-orange-800 hover:text-orange-900'
                          : 'text-blue-800 hover:text-blue-900'
                      }
                    >
                      ×
                    </button>
                    </span>
                  );
                })}
                {selectedTags.length === 0 && (
                  <span className="text-sm text-gray-500">タグが選択されていません。</span>
                )}
              </div>
              <div className="flex items-center gap-12 flex-nowrap overflow-x-auto border-t border-gray-200 pt-3">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-medium text-gray-600">追加:</span>
                  <select
                    value={selectedTagOption}
                    onChange={e => setSelectedTagOption(e.target.value)}
                    className="tag-select border rounded px-3 py-2 text-sm min-w-[200px]"
                  >
                    <option value="">既存タグを選択</option>
                    <optgroup label="Tag/Tech">
                      {availableTags
                        .filter(tag => tag.type === 'tech')
                        .map(tag => (
                          <option key={tag.id} value={tag.name}>
                            {tag.name}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Tag/Event">
                      {availableTags
                        .filter(tag => tag.type === 'event')
                        .map(tag => (
                          <option key={tag.id} value={tag.name}>
                            {tag.name}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Tag/Relation">
                      {availableTags
                        .filter(tag => tag.type === 'relation')
                        .map(tag => (
                          <option key={tag.id} value={tag.name}>
                            {tag.name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const normalized = selectedTagOption.trim();
                      if (!normalized) return;
                      if (selectedTags.includes(normalized)) return;
                      setTagsTouched(true);
                      setSelectedTags(prev => [...prev, normalized]);
                      setSelectedTagOption('');
                    }}
                    className="bg-blue-600 text-white px-3 py-2 rounded"
                  >
                    追加
                  </button>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-medium text-gray-600">作成:</span>
                  <input
                    type="text"
                    value={customTag}
                    onChange={e => setCustomTag(e.target.value)}
                    className="border rounded px-3 py-2 min-w-[140px] w-40"
                    placeholder="タグを追加"
                  />
                  <select
                    value={newTagType}
                    onChange={e => setNewTagType(e.target.value as 'tech' | 'event' | 'relation')}
                    className={`border rounded px-2 py-2 text-sm ${
                      newTagType === 'relation'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : newTagType === 'event'
                        ? 'bg-orange-50 text-orange-700 border-orange-300'
                        : 'bg-blue-50 text-blue-700 border-blue-300'
                    }`}
                  >
                    <option value="tech">Tag/Tech</option>
                    <option value="event">Tag/Event</option>
                    <option value="relation">Tag/Relation</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const normalized = customTag.trim();
                      if (!normalized) return;
                      if (selectedTags.includes(normalized)) return;
                      setTagsTouched(true);
                      setSelectedTags(prev => [...prev, normalized]);
                      setAvailableTags(prev => {
                        if (prev.some(tag => tag.name === normalized)) return prev;
                        return [...prev, { id: Date.now(), name: normalized, type: newTagType }];
                      });
                      setCustomTag('');
                    }}
                    className="bg-gray-800 text-white px-3 py-2 rounded"
                  >
                    追加
                  </button>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-medium text-gray-600">属性変更:</span>
                  <select
                    value={manageTagId}
                    onChange={e => setManageTagId(e.target.value ? Number(e.target.value) : '')}
                    className="tag-select border rounded px-3 py-2 text-sm min-w-[200px]"
                  >
                    <option value="">タグ管理対象を選択</option>
                    {availableTags.map(tag => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={manageTagType}
                    onChange={e => setManageTagType(e.target.value as 'tech' | 'event' | 'relation')}
                    className="border rounded px-2 py-2 text-sm"
                    disabled={!manageTagId}
                  >
                    <option value="tech">Tag/Tech</option>
                    <option value="event">Tag/Event</option>
                    <option value="relation">Tag/Relation</option>
                  </select>
                  <button
                    type="button"
                    className="px-3 py-2 text-sm rounded border bg-white disabled:opacity-50"
                    disabled={!manageTagId}
                    onClick={async () => {
                      const target = availableTags.find(tag => tag.id === manageTagId);
                      if (!target) return;
                      try {
                        await axios.put(`http://localhost:8000/tags/${target.id}`, {
                          name: target.name,
                          type: manageTagType,
                        });
                        setAvailableTags(prev =>
                          prev.map(tag => (tag.id === target.id ? { ...tag, type: manageTagType } : tag)),
                        );
                        setFlashMessage('タグ属性を更新しました。');
                      } catch (error) {
                        console.error('tag update failed', error);
                        setSubmitError('タグ属性の更新に失敗しました。');
                      }
                    }}
                  >
                    属性変更
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 text-sm rounded border border-red-200 text-red-700 bg-red-50 disabled:opacity-50"
                    disabled={!manageTagId}
                    onClick={async () => {
                      const target = availableTags.find(tag => tag.id === manageTagId);
                      if (!target) return;
                      const confirmed = window.confirm(`タグ「${target.name}」を削除しますか？`);
                      if (!confirmed) return;
                      try {
                        await axios.delete(`http://localhost:8000/tags/${target.id}`);
                        setAvailableTags(prev => prev.filter(tag => tag.id !== target.id));
                        setSelectedTags(prev => prev.filter(tag => tag !== target.name));
                        setDetectedTags(prev => prev.filter(tag => tag !== target.name));
                        setManageTagId('');
                        setFlashMessage('タグを削除しました。');
                      } catch (error) {
                        console.error('tag delete failed', error);
                        setSubmitError('タグ削除に失敗しました。');
                      }
                    }}
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <label className="w-32 text-sm font-medium pt-2">メモ</label>
            <textarea
              value={form.notes}
              onChange={handleChange('notes')}
              className="flex-1 border rounded px-3 py-2 h-28"
            />
          </div>
          <div className="pt-2 flex items-center gap-6">
            <button
              type="submit"
              disabled={isSubmitting || isOcrRunning}
              className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {isOcrRunning ? 'OCR処理中...' : isSubmitting ? '登録中...' : '登録する'}
            </button>
            <button
              type="button"
              onClick={resetFormInputs}
              className="px-4 py-2 rounded border border-red-200 text-red-600 bg-white"
            >
              クリア
            </button>
          </div>
    </form>
  );

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">連絡先登録</h1>
      {flashMessage && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashMessage}
        </div>
      )}
      <div className="bg-white p-6 rounded-lg shadow w-full max-w-none mx-auto overflow-hidden">
        {!isEdit && (
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-4 py-2 rounded ${mode === 'manual' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-800'}`}
            >
              手入力
            </button>
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`px-4 py-2 rounded ${mode === 'upload' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-800'}`}
            >
              名刺アップロード
            </button>
          </div>
        )}

        {mode === 'upload' ? (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)] gap-6">
            {uploadColumn}
            <div>{formColumn}</div>
          </div>
        ) : (
          <div className="w-full">{formColumn}</div>
        )}
      </div>
    </div>
  );
};

export default ContactRegister;
