import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer } from 'react-konva';
import useImage from 'use-image';

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
  type: 'technology' | 'relation' | string;
};

type RoiField = 'name' | 'company' | 'branch' | 'role' | 'email' | 'phone' | 'mobile' | 'postal_code' | 'address';

type CameraCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  focusDistance?: { min: number; max: number; step?: number };
  zoom?: { min: number; max: number; step?: number };
};

type RoiRect = {
  id: string;
  field: RoiField;
  x: number;
  y: number;
  w: number;
  h: number;
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
  const todayString = (() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();
  const [form, setForm] = useState({
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [konvaImage] = useImage(imageUrl || '', 'anonymous');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [rois, setRois] = useState<RoiRect[]>([]);
  const [selectedRoiId, setSelectedRoiId] = useState<string | null>(null);
  const [templateCompany, setTemplateCompany] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [lastTemplateCompany, setLastTemplateCompany] = useState<string | null>(null);
  const transformerRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [templates, setTemplates] = useState<{ company_name: string; template_name: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
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
  const isBlank = (value?: string) => !value || value.trim() === '';
  const targetWidth = 1200;
  const targetHeight = 700;
  const [bulkMoveStep, setBulkMoveStep] = useState(2);
  const dragAllRef = useRef<{ x: number; y: number } | null>(null);

  const defaultRois = (width: number, height: number): RoiRect[] => [
    { id: 'name', field: 'name', x: width * 0.1, y: height * 0.45, w: width * 0.4, h: height * 0.1 },
    { id: 'company', field: 'company', x: width * 0.1, y: height * 0.1, w: width * 0.5, h: height * 0.1 },
    { id: 'branch', field: 'branch', x: width * 0.1, y: height * 0.23, w: width * 0.5, h: height * 0.08 },
    { id: 'role', field: 'role', x: width * 0.1, y: height * 0.35, w: width * 0.4, h: height * 0.08 },
    { id: 'email', field: 'email', x: width * 0.1, y: height * 0.65, w: width * 0.5, h: height * 0.07 },
    { id: 'phone', field: 'phone', x: width * 0.1, y: height * 0.74, w: width * 0.35, h: height * 0.07 },
    { id: 'mobile', field: 'mobile', x: width * 0.5, y: height * 0.74, w: width * 0.35, h: height * 0.07 },
    { id: 'postal_code', field: 'postal_code', x: width * 0.1, y: height * 0.80, w: width * 0.3, h: height * 0.06 },
    { id: 'address', field: 'address', x: width * 0.1, y: height * 0.88, w: width * 0.8, h: height * 0.08 },
  ];
  const roiLabels: Record<RoiField, string> = {
    name: '氏名',
    company: '会社名',
    branch: '支店 / Office',
    role: '役職・部署',
    email: 'メール',
    phone: '電話',
    mobile: '携帯',
    postal_code: '郵便番号',
    address: '住所',
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

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    if (!nextFile) return;
    resizeImageFile(nextFile)
      .then(({ blob, file }) => {
        setFile(file);
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
        setCardFilename(file.name);
      })
      .catch(() => {
        const url = URL.createObjectURL(nextFile);
        setImageUrl(url);
        setCardFilename(nextFile.name);
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
          setImageUrl(url);
          setCardFilename(file.name);
          stopCamera();
        })
        .catch(() => {
          const url = URL.createObjectURL(capturedFile);
          setFile(capturedFile);
          setImageUrl(url);
          setCardFilename(capturedFile.name);
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

  const matchTemplate = async (img: HTMLImageElement) => {
    const baseWidth = img.naturalWidth || img.width;
    const baseHeight = img.naturalHeight || img.height;
    if (!baseWidth || !baseHeight) return;
    const canvas = document.createElement('canvas');
    const cropHeight = Math.floor(baseHeight * 0.25);
    canvas.width = baseWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, baseWidth, cropHeight, 0, 0, baseWidth, cropHeight);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const formData = new FormData();
    formData.append('field', 'company');
    formData.append('image', blob, 'company.png');
    const ocrResponse = await axios.post<{ field: string; text: string }>(
      'http://localhost:8000/cards/ocr-region',
      formData,
    );
    const companyText = extractCompanyCandidate(ocrResponse.data.text);
    if (!companyText) return;
    const normalizedCompany = companyText.replace(/\s+/g, '');
    const hasTemplate = templates.some(
      template => template.company_name.replace(/\s+/g, '') === normalizedCompany,
    );
    if (!hasTemplate) return;
    try {
      const templateResponse = await axios.get<any[]>(
        `http://localhost:8000/roi/templates/${encodeURIComponent(companyText)}`,
      );
      const template = templateResponse.data[0];
      if (!template) return;
      const loadedRois = template.rois.map((roi: any) => {
        const normalized = roi.x <= 1 && roi.y <= 1 && roi.w <= 1 && roi.h <= 1;
        return {
          id: roi.field,
          field: roi.field,
          x: normalized ? roi.x * baseWidth : roi.x,
          y: normalized ? roi.y * baseHeight : roi.y,
          w: normalized ? roi.w * baseWidth : roi.w,
          h: normalized ? roi.h * baseHeight : roi.h,
        };
      });
      if (template.company_name && template.template_name) {
        setSelectedTemplate(`${template.company_name}||${template.template_name}`);
      } else {
        setSelectedTemplate(template.template_name || '');
      }
      setTemplateName(template.template_name || '');
      setTemplateCompany(template.company_name || '');
      setLastTemplateCompany(template.company_name || null);
      setRois(loadedRois);
    } catch (error) {
      if (batchMode && lastTemplateCompany) {
        setTemplateCompany(lastTemplateCompany);
      }
    }
  };

  const loadTemplateByName = async () => {
    if (!selectedTemplate) return;
    if (!konvaImage) return;
    if (!imageSize.width || !imageSize.height) return;
    const [selectedCompany, selectedName] = selectedTemplate.split('||');
    const templateKey = selectedName ? selectedCompany : selectedTemplate;
    const templateName = selectedName || selectedTemplate;
    const templateResponse = await axios.get<any[]>(
      `http://localhost:8000/roi/templates/${encodeURIComponent(templateKey)}`,
    );
    const template = selectedName
      ? templateResponse.data.find((item: any) => item.template_name === templateName)
      : templateResponse.data[0];
    if (!template) return;
    const baseWidth = imageSize.width;
    const baseHeight = imageSize.height;
    const loadedRois = template.rois.map((roi: any) => {
      const normalized = roi.x <= 1 && roi.y <= 1 && roi.w <= 1 && roi.h <= 1;
      return {
        id: roi.field,
        field: roi.field,
        x: normalized ? roi.x * baseWidth : roi.x,
        y: normalized ? roi.y * baseHeight : roi.y,
        w: normalized ? roi.w * baseWidth : roi.w,
        h: normalized ? roi.h * baseHeight : roi.h,
      };
    });
    setTemplateCompany(template.company_name || '');
    setTemplateName(template.template_name || '');
    setLastTemplateCompany(template.company_name || null);
    if (template.company_name && template.template_name) {
      setSelectedTemplate(`${template.company_name}||${template.template_name}`);
    }
    setRois(loadedRois);
  };

  useEffect(() => {
    if (!konvaImage) return;
    const applyImageSize = () => {
      const naturalWidth = konvaImage.naturalWidth || konvaImage.width;
      const naturalHeight = konvaImage.naturalHeight || konvaImage.height;
      if (!naturalWidth || !naturalHeight) return;
      setImageSize({ width: naturalWidth, height: naturalHeight });
      if (rois.length === 0 && (!batchMode || !lastTemplateCompany)) {
        setRois(defaultRois(naturalWidth, naturalHeight));
      }
      matchTemplate(konvaImage).catch(() => undefined);
    };

    applyImageSize();
    if (!konvaImage.complete || konvaImage.naturalWidth === 0) {
      konvaImage.addEventListener('load', applyImageSize);
      return () => {
        konvaImage.removeEventListener('load', applyImageSize);
      };
    }
    return undefined;
  }, [konvaImage, batchMode, lastTemplateCompany, rois.length]);

  useEffect(() => {
    const node = canvasContainerRef.current;
    if (!node) return;
    const update = () => {
      setContainerWidth(node.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [mode, konvaImage]);

  useEffect(() => {
    if (!imageSize.width || !imageSize.height || !containerWidth) return;
    const maxEditorHeight = window.innerHeight * 0.7;
    const newScale = Math.min(
      containerWidth / imageSize.width,
      maxEditorHeight / imageSize.height,
    );
    if (newScale > 0) {
      setScale(newScale);
    }
  }, [imageSize.width, imageSize.height, containerWidth]);

  useEffect(() => {
    if (!transformerRef.current) return;
    const stage = transformerRef.current.getStage();
    if (!stage) return;
    const selected = stage.findOne(`#${selectedRoiId}`);
    transformerRef.current.nodes(selected ? [selected] : []);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedRoiId, rois]);

  useEffect(() => {
    axios.get<{ company_name: string; template_name: string }[]>('http://localhost:8000/roi/templates')
      .then(response => setTemplates(response.data))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    axios.get<TagOption[]>('http://localhost:8000/tags')
      .then(response => {
        const tags = response.data.filter(tag => tag.name);
        tags.sort((a, b) => {
          const typeOrder = (value: string) => (value === 'relation' ? 1 : 0);
          const diff = typeOrder(a.type) - typeOrder(b.type);
          if (diff !== 0) return diff;
          return a.name.localeCompare(b.name, 'ja');
        });
        setAvailableTags(tags);
      })
      .catch(() => setAvailableTags([]));
  }, []);

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

  const runRoiOcr = async () => {
    console.log('ROI OCR started');
    if (!konvaImage || rois.length === 0) {
      console.log('ROI OCR skipped: imageObj or rois missing');
      return;
    }
    console.log('ROI count:', rois.length);
    setIsOcrRunning(true);
    try {
      for (const roi of rois) {
        console.log('Processing ROI:', roi.field, roi);
        const canvas = document.createElement('canvas');
        canvas.width = roi.w;
        canvas.height = roi.h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.log('Canvas context missing');
          continue;
        }
        ctx.drawImage(
          konvaImage,
          roi.x,
          roi.y,
          roi.w,
          roi.h,
          0,
          0,
          roi.w,
          roi.h,
        );
        const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) continue;
        console.log('ROI image blob created for:', roi.field);
        const formData = new FormData();
        formData.append('field', roi.field);
        formData.append('image', blob, `${roi.field}.png`);
        console.log('Sending OCR request:', roi.field);
        const response = await axios.post<{ field: string; text: string }>(
          'http://localhost:8000/cards/ocr-region',
          formData,
        );
        console.log('OCR response:', response.data);
        const text = response.data.text;
        setForm(prev => {
          if (roi.field === 'name') {
            if (!isBlank(prev.name)) return prev;
            return { ...prev, name: normalizePersonName(text) };
          }
          if (roi.field === 'company') {
            if (!isBlank(prev.company)) return prev;
            return { ...prev, company: normalizeCompanyName(text) };
          }
          if (roi.field === 'branch') {
            if (!isBlank(prev.branch)) return prev;
            return { ...prev, branch: text };
          }
          if (roi.field === 'phone') {
            if (!isBlank(prev.phone)) return prev;
            return { ...prev, phone: text };
          }
          if (roi.field === 'mobile') {
            if (!isBlank(prev.mobile)) return prev;
            return { ...prev, mobile: text };
          }
          if (roi.field === 'role') {
            if (!isBlank(prev.role)) return prev;
            return { ...prev, role: text };
          }
          if (roi.field === 'email') {
            if (!isBlank(prev.email)) return prev;
            return { ...prev, email: normalizeEmail(text) };
          }
          if (roi.field === 'postal_code') {
            if (!isBlank(prev.postal_code)) return prev;
            return { ...prev, postal_code: normalizePostalCode(text) };
          }
          if (roi.field === 'address') {
            const parsed = parsePostalAndAddress(text);
            if (!isBlank(prev.address)) {
              if (isBlank(prev.postal_code) && parsed.postalCode) {
                return { ...prev, postal_code: parsed.postalCode };
              }
              return prev;
            }
            return {
              ...prev,
              address: parsed.address || text,
              postal_code: isBlank(prev.postal_code) ? (parsed.postalCode || prev.postal_code) : prev.postal_code,
            };
          }
          return prev;
        });
      }
    } finally {
      setIsOcrRunning(false);
    }
    console.log('ROI OCR finished');
  };

  const saveTemplate = async () => {
    if (!konvaImage || !templateCompany || !templateName) return;
    if (!imageSize.width || !imageSize.height) return;
    const payload = {
      company_name: templateCompany,
      template_name: templateName,
      image_width: imageSize.width,
      image_height: imageSize.height,
      rois: rois.map(roi => ({
        field: roi.field,
        x: roi.x / imageSize.width,
        y: roi.y / imageSize.height,
        w: roi.w / imageSize.width,
        h: roi.h / imageSize.height,
      })),
    };
    await axios.post('http://localhost:8000/roi/templates', payload);
    setLastTemplateCompany(templateCompany);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting || isOcrRunning) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const tagsPayload = tagsTouched ? selectedTags : initialTags;
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

  const deleteTemplate = async () => {
    if (!selectedTemplate) return;
    const [selectedCompany, selectedName] = selectedTemplate.split('||');
    const templateName = selectedName || selectedTemplate;
    const deleteCompany = selectedName ? selectedCompany : templateCompany;
    const confirmed = window.confirm(`テンプレート「${templateName}」を削除しますか？`);
    if (!confirmed) return;
    await axios.delete(
      `http://localhost:8000/roi/templates/${encodeURIComponent(templateName)}?company_name=${encodeURIComponent(deleteCompany || '')}`,
    );
    const response = await axios.get<{ company_name: string; template_name: string }[]>('http://localhost:8000/roi/templates');
    setTemplates(response.data);
    setSelectedTemplate('');
  };

  const updateRoi = (id: string, attrs: Partial<RoiRect>) => {
    setRois(prev => prev.map(roi => (roi.id === id ? { ...roi, ...attrs } : roi)));
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const shiftAllRois = (dx: number, dy: number) => {
    if (!imageSize.width || !imageSize.height) return;
    setRois(prev => prev.map(roi => {
      const nextX = clamp(roi.x + dx, 0, Math.max(0, imageSize.width - roi.w));
      const nextY = clamp(roi.y + dy, 0, Math.max(0, imageSize.height - roi.h));
      return { ...roi, x: nextX, y: nextY };
    }));
  };

  const handleStageDragStart = (event: any) => {
    const stage = event.target.getStage?.();
    if (!stage || event.target !== stage) return;
    const pos = stage.getPointerPosition?.();
    if (!pos) return;
    dragAllRef.current = { x: pos.x, y: pos.y };
  };

  const handleStageDragMove = (event: any) => {
    if (!dragAllRef.current) return;
    const stage = event.target.getStage?.();
    if (!stage) return;
    const pos = stage.getPointerPosition?.();
    if (!pos) return;
    if (!scale) return;
    const dx = (pos.x - dragAllRef.current.x) / scale;
    const dy = (pos.y - dragAllRef.current.y) / scale;
    if (dx === 0 && dy === 0) return;
    shiftAllRois(dx, dy);
    dragAllRef.current = { x: pos.x, y: pos.y };
  };

  const handleStageDragEnd = () => {
    dragAllRef.current = null;
  };

  const stageHeight = imageSize.width > 0 && containerWidth > 0
    ? containerWidth * (imageSize.height / imageSize.width)
    : 0;

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
            setImageUrl(cacheBusted);
            setCardFilename(response.data.filename || 'mobile-upload.png');
            setLastMobileUploadCount(uploadCount);
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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">連絡先登録</h1>
      {flashMessage && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashMessage}
        </div>
      )}
      <div className="bg-white p-6 rounded-lg shadow w-full max-w-[1280px] mx-auto overflow-hidden">
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

        {mode === 'upload' && (
          <div className="mb-6 border border-dashed border-gray-300 rounded p-4">
            <div className="flex items-center gap-4">
              <input
                type="file"
                onChange={handleFileChange}
                className="block"
              />
            </div>
            {cardFilename && (
              <p className="mt-2 text-sm text-gray-600">Loaded: {cardFilename}</p>
            )}
            <div className="mt-4 border-t border-gray-200 pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={startMobileUploadSession}
                  disabled={mobileSessionLoading}
                  className="bg-emerald-600 text-white px-4 py-2 rounded cursor-pointer relative z-10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {mobileSessionLoading ? 'QR生成中...' : 'スマホで撮影（QR表示）'}
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
        )}

        {isCameraActive && (
          <div className="relative mt-4">
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

        {mode === 'upload' && konvaImage && (
          <div className="mb-6 bg-gray-50 border border-gray-200 rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">ROIエディタ</h2>
              <label className="text-sm text-gray-600 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={batchMode}
                  onChange={e => setBatchMode(e.target.checked)}
                />
                バッチスキャン
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="text-xs text-gray-600">一括移動</span>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">移動量(px)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={bulkMoveStep}
                  onChange={e => setBulkMoveStep(Number(e.target.value) || 1)}
                  className="w-20 border rounded px-2 py-1 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => shiftAllRois(-bulkMoveStep, 0)}
                  className="px-2 py-1 text-xs border rounded"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => shiftAllRois(bulkMoveStep, 0)}
                  className="px-2 py-1 text-xs border rounded"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => shiftAllRois(0, -bulkMoveStep)}
                  className="px-2 py-1 text-xs border rounded"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => shiftAllRois(0, bulkMoveStep)}
                  className="px-2 py-1 text-xs border rounded"
                >
                  ↓
                </button>
              </div>
            </div>
            <div
              ref={canvasContainerRef}
              className="border rounded bg-white w-full max-w-[1280px] mx-auto overflow-hidden"
              style={{ height: stageHeight || Math.floor(window.innerHeight * 0.7) }}
            >
              {imageSize.width > 0 && imageSize.height > 0 && containerWidth > 0 && (
                <Stage
                  width={containerWidth}
                  height={stageHeight}
                  onMouseDown={handleStageDragStart}
                  onMouseMove={handleStageDragMove}
                  onMouseUp={handleStageDragEnd}
                  onMouseLeave={handleStageDragEnd}
                  onTouchStart={handleStageDragStart}
                  onTouchMove={handleStageDragMove}
                  onTouchEnd={handleStageDragEnd}
                >
                  <Layer scaleX={scale} scaleY={scale} listening={false}>
                    {konvaImage && (
                      <KonvaImage
                        image={konvaImage}
                        width={imageSize.width}
                        height={imageSize.height}
                        listening={false}
                        perfectDrawEnabled={false}
                        imageSmoothingEnabled={false}
                      />
                    )}
                  </Layer>
                  <Layer scaleX={scale} scaleY={scale}>
                    {rois.map(roi => (
                      <React.Fragment key={roi.id}>
                        <Rect
                          id={roi.id}
                          x={roi.x}
                          y={roi.y}
                          width={roi.w}
                          height={roi.h}
                          stroke="#ef4444"
                          strokeWidth={2}
                          draggable
                          perfectDrawEnabled={false}
                          shadowForStrokeEnabled={false}
                          onClick={() => setSelectedRoiId(roi.id)}
                          onTap={() => setSelectedRoiId(roi.id)}
                          onDragEnd={e => {
                            updateRoi(roi.id, {
                              x: e.target.x(),
                              y: e.target.y(),
                            });
                          }}
                          onTransformEnd={e => {
                            const node = e.target;
                            const scaleX = node.scaleX();
                            const scaleY = node.scaleY();
                            node.scaleX(1);
                            node.scaleY(1);
                            updateRoi(roi.id, {
                              x: node.x(),
                              y: node.y(),
                              w: Math.max(10, node.width() * scaleX),
                              h: Math.max(10, node.height() * scaleY),
                            });
                          }}
                        />
                        <Text
                          x={roi.x + 4}
                          y={roi.y + 4}
                          text={roiLabels[roi.field]}
                          fontSize={16}
                          fill="#ef4444"
                          perfectDrawEnabled={false}
                        />
                      </React.Fragment>
                    ))}
                    <Transformer
                      ref={transformerRef}
                      rotateEnabled={false}
                      keepRatio={false}
                      enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                    />
                  </Layer>
                </Stage>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runRoiOcr}
                disabled={isOcrRunning}
                className="bg-emerald-600 text-white px-3 py-2 rounded disabled:opacity-50"
              >
                OCR実行
              </button>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">ROIテンプレート</label>
                <select
                  value={selectedTemplate}
                  onChange={e => setSelectedTemplate(e.target.value)}
                  className="border rounded px-2 py-2 text-sm"
                >
                  <option value="">テンプレートを選択</option>
                  {templates.map(template => (
                    <option
                      key={`${template.company_name}-${template.template_name}`}
                      value={`${template.company_name}||${template.template_name}`}
                    >
                      {template.template_name} ({template.company_name})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={loadTemplateByName}
                  className="bg-blue-600 text-white px-3 py-2 rounded"
                >
                  読み込み
                </button>
                <button
                  type="button"
                  onClick={deleteTemplate}
                  disabled={!selectedTemplate}
                  className="bg-red-600 text-white px-3 py-2 rounded disabled:opacity-50"
                >
                  削除
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTemplate('');
                    setTemplateCompany('');
                    setTemplateName('');
                    setRois([]);
                  }}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  クリア
                </button>
              </div>
              <input
                type="text"
                value={templateCompany}
                onChange={e => setTemplateCompany(e.target.value)}
                placeholder="会社名"
                className="border rounded px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="テンプレート名"
                className="border rounded px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={saveTemplate}
                className="bg-gray-800 text-white px-3 py-2 rounded"
              >
                保存
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 bg-gray-50 border border-gray-200 rounded p-4">
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

        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <div className="text-sm text-red-600">{submitError}</div>
          )}
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
            <label className="w-32 text-sm font-medium">メール</label>
            <input
              type="email"
              value={form.email}
              onChange={handleChange('email')}
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
            <label className="w-32 text-sm font-medium">役職・部署</label>
            <input
              type="text"
              value={form.role}
              onChange={handleChange('role')}
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
                    ? 'bg-amber-100 text-amber-800'
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
                      className={tagType === 'relation' ? 'text-amber-800 hover:text-amber-900' : 'text-blue-800 hover:text-blue-900'}
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
              <div className="flex flex-wrap gap-2">
                <select
                  value={selectedTagOption}
                  onChange={e => setSelectedTagOption(e.target.value)}
                  className="tag-select border rounded px-3 py-2 text-sm min-w-[200px]"
                >
                  <option value="">既存タグを選択</option>
                  <optgroup label="Tag/Tech">
                    {availableTags
                      .filter(tag => tag.type !== 'relation')
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
                <input
                  type="text"
                  value={customTag}
                  onChange={e => setCustomTag(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 min-w-[200px]"
                  placeholder="タグを追加"
                />
                <button
                  type="button"
                  onClick={() => {
                    const normalized = customTag.trim();
                    if (!normalized) return;
                    if (selectedTags.includes(normalized)) return;
                    setTagsTouched(true);
                    setSelectedTags(prev => [...prev, normalized]);
                    setCustomTag('');
                  }}
                  className="bg-gray-800 text-white px-3 py-2 rounded"
                >
                  追加
                </button>
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
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || isOcrRunning}
              className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {isOcrRunning ? 'OCR処理中...' : isSubmitting ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ContactRegister;
