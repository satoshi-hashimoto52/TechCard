import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

type ShortcutItem = {
  label: string;
  action: string;
  path?: string;
};

const shortcuts: ShortcutItem[] = [
  { label: 'Ctrl+K Search', action: 'Search' },
  { label: 'G Network', action: 'Graph', path: '/network' },
  { label: 'C Contacts', action: 'Contacts', path: '/contacts' },
  { label: 'E Events', action: 'Events', path: '/events' },
  { label: 'I Insights', action: 'Insights', path: '/insights' },
];

type ShortcutPanelProps = {
  embedded?: boolean;
  bottomClassName?: string;
};

const ShortcutPanel: React.FC<ShortcutPanelProps> = ({ embedded = false, bottomClassName }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const defaultBottom = embedded ? 'bottom-12' : 'bottom-4';
  const positionClass = embedded
    ? `absolute left-4 ${bottomClassName || defaultBottom}`
    : `fixed left-4 ${bottomClassName || defaultBottom}`;

  return (
    <div className={`${positionClass} z-40`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="rounded-full bg-gray-900 text-white px-3 py-2 text-xs shadow"
      >
        ⌨ ショートカット
      </button>
      {open && (
        <div className="mt-2 w-56 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg">
          <div className="text-xs font-semibold text-gray-500 mb-2">ショートカット</div>
          <div className="space-y-2">
            {shortcuts.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (item.path) {
                    navigate(item.path);
                  }
                }}
                className="w-full text-left text-gray-700 hover:text-gray-900"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ShortcutPanel;
