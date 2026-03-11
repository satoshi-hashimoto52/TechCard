import React from 'react';
import { Layer } from 'react-map-gl/maplibre';

type HeatmapLayerProps = {
  sourceId: string;
};

const HeatmapLayer: React.FC<HeatmapLayerProps> = ({ sourceId }) => {
  return (
    <Layer
      id="companies-heatmap"
      type="heatmap"
      source={sourceId}
      minzoom={8}
      paint={{
        'heatmap-weight': 1,
        'heatmap-intensity': 1,
        'heatmap-radius': 18,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(0, 0, 128, 0)',
          0.2,
          '#2563eb',
          0.5,
          '#22d3ee',
          0.8,
          '#f97316',
          1,
          '#ef4444',
        ],
      }}
    />
  );
};

export default HeatmapLayer;
