import React from 'react';

type CompanyClusterProps = {
  count: number;
  onClick?: () => void;
};

const CompanyCluster: React.FC<CompanyClusterProps> = ({ count, onClick }) => {
  return (
    <button type="button" className="cluster-marker" onClick={onClick}>
      {count}
    </button>
  );
};

export default CompanyCluster;
