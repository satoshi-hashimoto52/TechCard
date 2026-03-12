import React from 'react';
import { CompanyMapPoint } from './LedJapanMap';

type LedMarkerProps = {
  company: CompanyMapPoint;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
  labelOffset?: { x: number; y: number };
};

const LedMarker: React.FC<LedMarkerProps> = ({ company, onMouseEnter, onMouseLeave, onClick, labelOffset }) => {
  const offset = labelOffset ?? { x: 14, y: -10 };
  return (
    <button
      type="button"
      className={`led-marker-wrap ${company.is_self ? 'led-marker-wrap--self' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <span className="led-marker">
        <span className="led-marker__core" />
        <span className="led-marker__pulse" />
      </span>
      <span className="led-marker__label" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
        <span className="led-marker__name">{company.name}</span>
        <span className="led-marker__city">{company.city || ''}</span>
      </span>
    </button>
  );
};

export default LedMarker;
