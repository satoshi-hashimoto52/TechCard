import React, { useMemo } from 'react';
import { CompanyMapPoint } from './LedJapanMap';

type GeocodeProgressProps = {
  companies: CompanyMapPoint[];
};

type GeocodeStatus = {
  label: string;
  className: string;
  percent: number;
};

const getStatus = (company: CompanyMapPoint): GeocodeStatus => {
  const hasCoords = company.lat != null && company.lon != null;
  if (hasCoords) {
    return { label: '取得成功', className: 'geocode-progress--success', percent: 100 };
  }
  if (company.address || company.postal_code) {
    return { label: '取得失敗', className: 'geocode-progress--failed', percent: 30 };
  }
  return { label: '未取得', className: 'geocode-progress--pending', percent: 0 };
};

const GeocodeProgress: React.FC<GeocodeProgressProps> = ({ companies }) => {
  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    [companies],
  );
  const total = sortedCompanies.length || 1;
  const successCount = sortedCompanies.filter(company => company.lat != null && company.lon != null).length;
  const overall = Math.round((successCount / total) * 100);

  return (
    <div className="geocode-progress">
      <div className="geocode-progress__header">
        <span>会社ごとの取得進捗</span>
        <span className="geocode-progress__summary">
          {successCount}/{sortedCompanies.length} ({overall}%)
        </span>
      </div>
      <div className="geocode-progress__list">
        {sortedCompanies.map(company => {
          const status = getStatus(company);
          return (
            <div key={company.company_id} className="geocode-progress__row">
              <div className="geocode-progress__name" title={company.name}>
                {company.name}
              </div>
              <div className="geocode-progress__bar">
                <div
                  className={`geocode-progress__fill ${status.className}`}
                  style={{ width: `${status.percent}%` }}
                />
              </div>
              <div className={`geocode-progress__status ${status.className}`}>{status.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GeocodeProgress;
