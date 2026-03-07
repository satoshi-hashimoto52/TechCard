import React, { useState } from 'react';
import axios from 'axios';

const CardUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);

  const upload = () => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    axios.post('http://localhost:8000/cards/upload', formData).then(response => {
      setResult(response.data);
    });
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">名刺アップロード</h1>
      <input
        type="file"
        onChange={e => setFile(e.target.files?.[0] || null)}
        className="mb-4"
      />
      <button onClick={upload} className="bg-blue-500 text-white px-4 py-2 rounded">アップロード</button>
      {result && (
        <div className="mt-4 bg-white p-4 rounded-lg shadow">
          <h2 className="text-lg font-semibold">OCR結果</h2>
          <p><strong>氏名:</strong> {result.name}</p>
          <p><strong>会社:</strong> {result.company}</p>
          <p><strong>メール:</strong> {result.email}</p>
          <p><strong>電話:</strong> {result.phone}</p>
          <p><strong>生テキスト:</strong> {result.raw_text}</p>
        </div>
      )}
    </div>
  );
};

export default CardUpload;
