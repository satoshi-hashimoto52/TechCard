import React from 'react';
import { CompanyMapPoint } from './LedJapanMap';

type LedMarkerProps = {
  company: CompanyMapPoint;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
};

const LedMarker: React.FC<LedMarkerProps> = ({ company, onMouseEnter, onMouseLeave, onClick }) => {
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
      <span className="led-marker__label">
        <span className="led-marker__name">{company.name}</span>
        <span className="led-marker__city">{company.city || ''}</span>
      </span>
    </button>
  );
};

export default LedMarker;
