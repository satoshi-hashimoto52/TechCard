import React from 'react';
import { Link } from 'react-router-dom';

const Sidebar: React.FC = () => {
  return (
    <div className="bg-gray-800 text-white w-64 min-h-screen p-4">
      <h2 className="text-xl font-bold mb-6">TechCard</h2>
      <ul>
        <li className="mb-2">
          <Link to="/" className="block py-2 px-4 rounded hover:bg-gray-700">ダッシュボード</Link>
        </li>
        <li className="mb-2">
          <Link to="/contacts" className="block py-2 px-4 rounded hover:bg-gray-700">連絡先</Link>
        </li>
        <li className="mb-2">
          <Link to="/contacts/register" className="block py-2 px-4 rounded hover:bg-gray-700">連絡先登録</Link>
        </li>
        <li className="mb-2">
          <Link to="/technology-search" className="block py-2 px-4 rounded hover:bg-gray-700">技術検索</Link>
        </li>
        <li className="mb-2">
          <Link to="/network" className="block py-2 px-4 rounded hover:bg-gray-700">ネットワークグラフ</Link>
        </li>
        <li className="mb-2">
          <Link to="/card-upload" className="block py-2 px-4 rounded hover:bg-gray-700">名刺アップロード</Link>
        </li>
      </ul>
    </div>
  );
};

export default Sidebar;
