import React from 'react';

type ContextRow = {
  label: string;
  value: string | number;
};

type ContextData = {
  title: string;
  subtitle?: string;
  rows: ContextRow[];
};

type ContextPanelProps = {
  data: ContextData | null;
};

const ContextPanel: React.FC<ContextPanelProps> = ({ data }) => {
  return (
    <aside
      data-testid="network-context-panel"
      className="w-[360px] max-w-[40vw] flex-shrink-0 bg-white border-l border-gray-200 px-4 py-5 sticky top-4 self-start h-[calc(100vh-6rem)] overflow-y-auto"
    >
      <div className="text-sm font-semibold text-gray-500">コンテキスト</div>
      {!data && (
        <div data-testid="network-context-empty" className="mt-4 text-sm text-gray-500">ノードをクリックすると詳細が表示されます。</div>
      )}
      {data && (
        <div className="mt-4 space-y-3">
          <div>
            <div data-testid="network-context-title" className="text-lg font-semibold text-gray-900">{data.title}</div>
            {data.subtitle && <div className="text-sm text-gray-500">{data.subtitle}</div>}
          </div>
          <div className="space-y-2">
            {data.rows.map(row => (
              <div key={row.label} className="text-sm">
                <span className="text-gray-500">{row.label}: </span>
                <span className="text-gray-900 whitespace-pre-wrap break-words">{row.value || '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

export default ContextPanel;
