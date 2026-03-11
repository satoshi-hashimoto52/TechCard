import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Transformer, Image as KonvaImage, Text } from 'react-konva';
import useImage from 'use-image';

export type RoiField =
  | 'company'
  | 'branch'
  | 'name'
  | 'dept'
  | 'tel'
  | 'mobile'
  | 'mail'
  | 'postal'
  | 'address';

export type RoiTemplate = Record<RoiField, { x: number; y: number; w: number; h: number }>;

type RoiEditorProps = {
  imageUrl: string;
  template: RoiTemplate;
  onChange: (next: RoiTemplate) => void;
  baseWidth?: number;
  baseHeight?: number;
};

const LABELS: Record<RoiField, string> = {
  company: '会社名',
  branch: '支店/Office',
  name: '名前',
  dept: '部署/役職',
  tel: '電話',
  mobile: '携帯',
  mail: 'メール',
  postal: '郵便番号',
  address: '住所',
};

const RoiEditor: React.FC<RoiEditorProps> = ({
  imageUrl,
  template,
  onChange,
  baseWidth = 1200,
  baseHeight = 700,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<any>(null);
  const [selectedField, setSelectedField] = useState<RoiField | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState<{ x: number; y: number } | null>(null);
  const [roiImage] = useImage(imageUrl);

  useEffect(() => {
    if (!containerRef.current || !roiImage) return;
    const updateSize = () => {
      const width = containerRef.current?.clientWidth || 0;
      if (!width) return;
      const ratio = roiImage.height / roiImage.width;
      const height = Math.round(width * ratio);
      setStageSize({ width, height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [roiImage]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (!selectedField) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    const stage = transformer.getStage();
    if (!stage) return;
    const node = stage.findOne(`#roi-${selectedField}`);
    if (node) {
      transformer.nodes([node]);
      transformer.getLayer()?.batchDraw();
    }
  }, [selectedField, template]);

  const scaleX = stageSize.width / baseWidth;
  const scaleY = stageSize.height / baseHeight;

  const shiftAll = (dx: number, dy: number) => {
    onChange(
      (Object.keys(template) as RoiField[]).reduce((acc, field) => {
        const rect = template[field];
        const nextX = Math.min(Math.max(0, rect.x + dx), baseWidth - rect.w);
        const nextY = Math.min(Math.max(0, rect.y + dy), baseHeight - rect.h);
        acc[field] = { ...rect, x: nextX, y: nextY };
        return acc;
      }, {} as RoiTemplate),
    );
  };

  const handleStagePointerDown = (event: any) => {
    const stage = event.target?.getStage?.();
    if (!stage) return;
    const target = event.target;
    if (target === stage || target.name?.() === 'roi-image') {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      setSelectedField(null);
      setIsPanning(true);
      setLastPanPos({ x: pos.x, y: pos.y });
    }
  };

  const handleStagePointerMove = (event: any) => {
    if (!isPanning) return;
    const stage = event.target?.getStage?.();
    if (!stage || !lastPanPos) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const dx = (pos.x - lastPanPos.x) / scaleX;
    const dy = (pos.y - lastPanPos.y) / scaleY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
      shiftAll(dx, dy);
    }
    setLastPanPos({ x: pos.x, y: pos.y });
  };

  const handleStagePointerUp = () => {
    setIsPanning(false);
    setLastPanPos(null);
  };

  const updateTemplate = (field: RoiField, next: { x: number; y: number; w: number; h: number }) => {
    onChange({
      ...template,
      [field]: next,
    });
  };

  const renderRect = (field: RoiField) => {
    const rect = template[field];
    const display = {
      x: rect.x * scaleX,
      y: rect.y * scaleY,
      width: rect.w * scaleX,
      height: rect.h * scaleY,
    };
    return (
      <React.Fragment key={field}>
        <Rect
          id={`roi-${field}`}
          x={display.x}
          y={display.y}
          width={display.width}
          height={display.height}
          stroke={selectedField === field ? 'rgba(239,68,68,0.9)' : 'rgba(239,68,68,0.6)'}
          strokeWidth={2}
          draggable
          onClick={() => setSelectedField(field)}
          onTap={() => setSelectedField(field)}
          onDragEnd={event => {
            const nextX = event.target.x() / scaleX;
            const nextY = event.target.y() / scaleY;
            updateTemplate(field, { ...rect, x: nextX, y: nextY });
          }}
          onTransformEnd={event => {
            const node = event.target;
            const nextScaleX = node.scaleX();
            const nextScaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            const nextW = Math.max(5, node.width() * nextScaleX) / scaleX;
            const nextH = Math.max(5, node.height() * nextScaleY) / scaleY;
            const nextX = node.x() / scaleX;
            const nextY = node.y() / scaleY;
            updateTemplate(field, { x: nextX, y: nextY, w: nextW, h: nextH });
          }}
        />
        <Text
          x={display.x}
          y={Math.max(0, display.y - 18)}
          text={LABELS[field]}
          fontSize={12}
          fill="rgba(239,68,68,0.9)"
          padding={2}
        />
      </React.Fragment>
    );
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-4">
      <div className="text-xs text-gray-500 mb-3">ROIをドラッグ/リサイズして調整してください。</div>
      <div ref={containerRef} className="w-full border rounded bg-white overflow-hidden">
        {roiImage && stageSize.width > 0 ? (
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            onMouseDown={handleStagePointerDown}
            onMouseMove={handleStagePointerMove}
            onMouseUp={handleStagePointerUp}
            onMouseLeave={handleStagePointerUp}
            onTouchStart={handleStagePointerDown}
            onTouchMove={handleStagePointerMove}
            onTouchEnd={handleStagePointerUp}
          >
            <Layer>
              <KonvaImage
                name="roi-image"
                image={roiImage}
                width={stageSize.width}
                height={stageSize.height}
              />
              {(Object.keys(template) as RoiField[]).map(field => renderRect(field))}
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                keepRatio={false}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 10 || newBox.height < 10) {
                    return oldBox;
                  }
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        ) : (
          <div className="p-4 text-xs text-gray-500">画像を読み込み中です。</div>
        )}
      </div>
    </div>
  );
};

export default RoiEditor;
