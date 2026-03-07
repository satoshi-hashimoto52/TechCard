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

type RoiField = 'name' | 'company' | 'branch' | 'role' | 'email' | 'phone' | 'mobile' | 'address';

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
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    mobile: '',
    role: '',
    company: '',
    branch: '',
    address: '',
    notes: '',
  });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [konvaImage] = useImage(imageUrl || '');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [rois, setRois] = useState<RoiRect[]>([]);
  const [selectedRoiId, setSelectedRoiId] = useState<string | null>(null);
  const [templateCompany, setTemplateCompany] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [lastTemplateCompany, setLastTemplateCompany] = useState<string | null>(null);
  const transformerRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [templates, setTemplates] = useState<{ company_name: string; template_name: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const isEdit = Boolean(id);

  const defaultRois = (width: number, height: number): RoiRect[] => [
    { id: 'name', field: 'name', x: width * 0.1, y: height * 0.45, w: width * 0.4, h: height * 0.1 },
    { id: 'company', field: 'company', x: width * 0.1, y: height * 0.1, w: width * 0.5, h: height * 0.1 },
    { id: 'branch', field: 'branch', x: width * 0.1, y: height * 0.23, w: width * 0.5, h: height * 0.08 },
    { id: 'role', field: 'role', x: width * 0.1, y: height * 0.35, w: width * 0.4, h: height * 0.08 },
    { id: 'email', field: 'email', x: width * 0.1, y: height * 0.65, w: width * 0.5, h: height * 0.07 },
    { id: 'phone', field: 'phone', x: width * 0.1, y: height * 0.74, w: width * 0.35, h: height * 0.07 },
    { id: 'mobile', field: 'mobile', x: width * 0.5, y: height * 0.74, w: width * 0.35, h: height * 0.07 },
    { id: 'address', field: 'address', x: width * 0.1, y: height * 0.83, w: width * 0.8, h: height * 0.08 },
  ];
  const roiLabels: Record<RoiField, string> = {
    name: '氏名',
    company: '会社名',
    branch: '支店 / Office',
    role: '役職・部署',
    email: 'メール',
    phone: '電話',
    mobile: '携帯',
    address: '住所',
  };

  const handleChange = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [field]: event.target.value }));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    if (!nextFile) return;
    const url = URL.createObjectURL(nextFile);
    setImageUrl(url);
    setCardFilename(nextFile.name);
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
        address: data.address || '',
        notes: data.notes || '',
      });
      setSelectedTags((data.tags || []).map((tag: { name: string }) => tag.name));
      setInitialTags((data.tags || []).map((tag: { name: string }) => tag.name));
      setTagsTouched(false);
      setDetectedTags([]);
      setCustomTag('');
    });
  }, [isEdit, id]);

  const runRoiOcr = async () => {
    if (!konvaImage || rois.length === 0) return;
    setIsOcrRunning(true);
    try {
      for (const roi of rois) {
        const canvas = document.createElement('canvas');
        canvas.width = roi.w;
        canvas.height = roi.h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
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
        const formData = new FormData();
        formData.append('field', roi.field);
        formData.append('image', blob, `${roi.field}.png`);
        const response = await axios.post<{ field: string; text: string }>(
          'http://localhost:8000/cards/ocr-region',
          formData,
        );
        const text = response.data.text;
        setForm(prev => {
          if (roi.field === 'name') return { ...prev, name: text };
          if (roi.field === 'company') return { ...prev, company: text };
          if (roi.field === 'branch') return { ...prev, branch: text };
          if (roi.field === 'email') return { ...prev, email: text };
          if (roi.field === 'phone') return { ...prev, phone: text };
          if (roi.field === 'mobile') return { ...prev, mobile: text };
          if (roi.field === 'role') return { ...prev, role: text };
          if (roi.field === 'address') return { ...prev, address: text };
          return prev;
        });
      }
    } finally {
      setIsOcrRunning(false);
    }
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
    try {
      const tagsPayload = tagsTouched ? selectedTags : initialTags;
      const payload = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        role: form.role || null,
        mobile: form.mobile || null,
        address: form.address || null,
        branch: form.branch || null,
        company_name: form.company || null,
        tags: tagsPayload,
        notes: form.notes || null,
        card_filename: cardFilename,
        ocr_text: ocrText,
      };
      if (isEdit && id) {
        const response = await axios.put<ContactRegisterResponse>(`http://localhost:8000/contacts/${id}/register`, payload);
        navigate(`/contacts/${response.data.id}`);
      } else {
        const response = await axios.post<ContactRegisterResponse>('http://localhost:8000/contacts/register', payload);
        navigate(`/contacts/${response.data.id}`);
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      if (error?.response?.status === 409) {
        setSubmitError(detail || '既に同じメールまたは電話番号の連絡先が存在します。');
      } else {
        setSubmitError(detail || '登録に失敗しました。');
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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">連絡先登録</h1>
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
            <div className="flex items-center gap-3 mb-3">
              <label className="text-sm text-gray-600">ズーム</label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="w-48"
              />
              <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
            </div>
            <div
              ref={canvasContainerRef}
              className="border rounded bg-white w-full max-w-[1280px] mx-auto overflow-hidden"
              style={{ height: Math.floor(window.innerHeight * 0.7) }}
            >
              {imageSize.width > 0 && imageSize.height > 0 && containerWidth > 0 && (
                <Stage
                  width={containerWidth}
                  height={containerWidth * (imageSize.height / imageSize.width)}
                >
                  <Layer scaleX={scale} scaleY={scale}>
                    {konvaImage && (
                      <KonvaImage
                        image={konvaImage}
                        width={imageSize.width}
                        height={imageSize.height}
                      />
                    )}
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
                        fontSize={52}
                        fill="#ef4444"
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
            <label className="w-32 text-sm font-medium">氏名</label>
            <input
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              className="flex-1 border rounded px-3 py-2"
              required
            />
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
            <label className="w-32 text-sm font-medium">電話</label>
            <input
              type="tel"
              value={form.phone}
              onChange={handleChange('phone')}
              className="flex-1 border rounded px-3 py-2"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">会社</label>
            <input
              type="text"
              value={form.company}
              onChange={handleChange('company')}
              className="flex-1 border rounded px-3 py-2"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">支店 / Office</label>
            <input
              type="text"
              value={form.branch}
              onChange={handleChange('branch')}
              className="flex-1 border rounded px-3 py-2"
            />
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
            <label className="w-32 text-sm font-medium">携帯</label>
            <input
              type="text"
              value={form.mobile}
              onChange={handleChange('mobile')}
              className="flex-1 border rounded px-3 py-2"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="w-32 text-sm font-medium">住所</label>
            <input
              type="text"
              value={form.address}
              onChange={handleChange('address')}
              className="flex-1 border rounded px-3 py-2"
            />
          </div>
          <div className="flex items-start gap-4">
            <label className="w-32 text-sm font-medium pt-2">タグ</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedTags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => {
                      setTagsTouched(true);
                      setSelectedTags(prev => prev.filter(item => item !== tag));
                    }}
                    className="text-blue-800 hover:text-blue-900"
                  >
                    ×
                  </button>
                </span>
              ))}
              {selectedTags.length === 0 && (
                <span className="text-sm text-gray-500">タグが選択されていません。</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                className="flex-1 border rounded px-3 py-2"
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
