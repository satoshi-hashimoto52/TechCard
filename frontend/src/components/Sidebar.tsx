import React from 'react';
import { NavLink } from 'react-router-dom';
import axios from 'axios';

const Sidebar: React.FC = () => {
  const handleShutdown = async () => {
    const confirmed = window.confirm('アプリを終了しますか？');
    if (!confirmed) return;
    try {
      await axios.post('http://localhost:8000/admin/shutdown');
      alert('終了処理を開始しました。');
      setTimeout(() => {
        window.open('about:blank', '_self');
        window.close();
        setTimeout(() => {
          if (!window.closed) {
            alert('ブラウザが自動で閉じられませんでした。手動で閉じてください。');
          }
        }, 300);
      }, 300);
    } catch {
      alert('終了に失敗しました。サーバー起動状況を確認してください。');
    }
  };

  return (
    <div className="sidebar bg-gray-800 text-white w-64 min-w-max min-h-screen flex flex-col">
      <h2 className="sidebar__logo text-xl font-bold">TechCard</h2>
      <div className="px-4 pt-6">
        <ul>
        <li className="mb-2">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Dashboard
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/contacts"
            end
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Contacts
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/contacts/register"
            className={({ isActive }) =>
              `sidebar__link flex items-center gap-2 py-2 px-4 rounded whitespace-nowrap ${
                isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'
              }`
            }
          >
            Card Registration
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/company-groups"
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Companies
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/events"
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Events
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/timeline"
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Timeline
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/network"
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Network
          </NavLink>
        </li>
        <li className="mb-2">
          <NavLink
            to="/insights"
            className={({ isActive }) =>
              `sidebar__link block py-2 px-4 rounded whitespace-nowrap ${isActive ? 'sidebar__link--active' : 'hover:bg-gray-700'}`
            }
          >
            Insights
          </NavLink>
        </li>
        </ul>
      </div>
      <div className="mt-auto px-4 pb-4">
        <button
          type="button"
          onClick={handleShutdown}
          className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded"
        >
          終了
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
