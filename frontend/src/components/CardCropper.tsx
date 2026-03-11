import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

type Point = { x: number; y: number };

type CardCropperProps = {
  imageUrl: string;
  imageFile?: File | null;
  onCropped?: (dataUrl: string) => void;
  onPointCountChange?: (count: number) => void;
  initialPoints?: Point[] | null;
  extraActions?: React.ReactNode;
};

const POINT_RADIUS = 6;
const HIT_RADIUS = 10;
const FALLBACK_RATIO = 700 / 1200;

const CardCropper: React.FC<CardCropperProps> = ({
  imageUrl,
  imageFile,
  onCropped,
  onPointCountChange,
  initialPoints,
  extraActions,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetPoints = useCallback(() => {
    setPoints([]);
    setDragIndex(null);
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImage(img);
      resetPoints();
    };
    img.src = imageUrl;
  }, [imageUrl, resetPoints]);

  useEffect(() => {
    if (!image || !initialPoints || initialPoints.length !== 4) return;
    setPoints(prev => (prev.length === 0 ? initialPoints : prev));
    setDragIndex(null);
  }, [image, initialPoints]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateSize = () => {
      const width = node.clientWidth;
      if (!width) return;
      const ratio = image ? image.height / image.width : FALLBACK_RATIO;
      const height = Math.round(width * ratio);
      setCanvasSize({ width, height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [image]);

  const toImagePoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current || !image) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = image.width / canvasSize.width;
      const scaleY = image.height / canvasSize.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      return {
        x: Math.max(0, Math.min(image.width, x)),
        y: Math.max(0, Math.min(image.height, y)),
      };
    },
    [canvasSize.width, canvasSize.height, image],
  );

  const toCanvasPoint = useCallback(
    (point: Point) => {
      if (!image || canvasSize.width === 0) return { x: 0, y: 0 };
      const scaleX = canvasSize.width / image.width;
      const scaleY = canvasSize.height / image.height;
      return { x: point.x * scaleX, y: point.y * scaleY };
    },
    [canvasSize.width, canvasSize.height, image],
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('画像を読み込み中です', canvas.width / 2, canvas.height / 2);
      return;
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (points.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
      ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.beginPath();
      points.forEach((point, index) => {
        const { x, y } = toCanvasPoint(point);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (points.length === 4) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    }

    points.forEach((point, index) => {
      const { x, y } = toCanvasPoint(point);
      ctx.beginPath();
      ctx.fillStyle = index === dragIndex ? '#ef4444' : '#10b981';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }, [canvasSize.height, canvasSize.width, dragIndex, image, points, toCanvasPoint]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    onPointCountChange?.(points.length);
  }, [onPointCountChange, points.length]);

  const findHitPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      return points.findIndex(point => {
        const canvasPoint = toCanvasPoint(point);
        const dx = canvasPoint.x - (clientX - rect.left);
        const dy = canvasPoint.y - (clientY - rect.top);
        return Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS;
      });
    },
    [points, toCanvasPoint],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
    const hitIndex = findHitPoint(event.clientX, event.clientY);
    if (hitIndex !== null && hitIndex >= 0) {
      setDragIndex(hitIndex);
      return;
    }
    if (points.length >= 4) return;
    const nextPoint = toImagePoint(event.clientX, event.clientY);
    if (!nextPoint) return;
    setPoints(prev => [...prev, nextPoint]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragIndex === null) return;
    const nextPoint = toImagePoint(event.clientX, event.clientY);
    if (!nextPoint) return;
    setPoints(prev => prev.map((point, index) => (index === dragIndex ? nextPoint : point)));
  };

  const handlePointerUp = () => {
    setDragIndex(null);
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });

  const toDataUrl = async () => {
    if (imageUrl.startsWith('data:')) {
      return imageUrl;
    }
    if (imageFile) {
      return await readFileAsDataUrl(imageFile);
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`image fetch failed (${response.status})`);
      }
      const blob = await response.blob();
      return await readFileAsDataUrl(new File([blob], 'crop-source.png', { type: blob.type || 'image/png' }));
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleCrop = async () => {
    if (points.length !== 4 || !image) return;
    setIsCropping(true);
    setError(null);
    try {
      const dataUrl = await toDataUrl();
      const response = await axios.post<{ cropped_image: string }>(
        'http://localhost:8000/card/crop',
        {
          image: dataUrl,
          points,
        },
        { timeout: 15000 },
      );
      const cropped = response.data.cropped_image;
      const result = cropped.startsWith('data:') ? cropped : `data:image/png;base64,${cropped}`;
      onCropped?.(result);
    } catch (err) {
      console.error('crop failed', err);
      setError('クロップに失敗しました。バックエンドの起動と画像取得を確認してください。');
    } finally {
      setIsCropping(false);
    }
  };

  return (
    <div className="space-y-3" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="w-full rounded border bg-white"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      {error && (
        <div className="text-xs text-red-600">{error}</div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={resetPoints}
          className="px-3 py-2 text-sm border rounded"
        >
          ポイントリセット
        </button>
        <button
          type="button"
          onClick={handleCrop}
          disabled={points.length !== 4 || isCropping}
          className="px-3 py-2 text-sm rounded bg-emerald-600 text-white disabled:opacity-50"
        >
          {isCropping ? 'クロップ中...' : 'クロップ実行'}
        </button>
        {extraActions}
      </div>
    </div>
  );
};

export default CardCropper;
