import React from 'react';
import { Link } from 'react-router-dom';
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
    <div className="bg-gray-800 text-white w-64 min-w-max min-h-screen p-4 flex flex-col">
      <h2 className="text-xl font-bold mb-6">TechCard</h2>
      <ul>
        <li className="mb-2">
          <Link to="/contacts" className="block py-2 px-4 rounded hover:bg-gray-700 whitespace-nowrap">連絡先</Link>
        </li>
        <li className="mb-2">
          <Link to="/contacts/register" className="block py-2 px-4 rounded hover:bg-gray-700 whitespace-nowrap">連絡先登録</Link>
        </li>
        <li className="mb-2">
          <Link to="/network" className="block py-2 px-4 rounded hover:bg-gray-700 whitespace-nowrap">ネットワークグラフ</Link>
        </li>
        <li className="mb-2">
          <Link to="/events" className="block py-2 px-4 rounded hover:bg-gray-700 whitespace-nowrap">イベント登録</Link>
        </li>
        <li className="mb-2">
          <Link to="/" className="block py-2 px-4 rounded hover:bg-gray-700 whitespace-nowrap">ダッシュボード</Link>
        </li>
      </ul>
      <div className="mt-auto pt-4">
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
