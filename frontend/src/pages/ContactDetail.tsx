import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';

interface Contact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  mobile?: string;
  postal_code?: string;
  address?: string;
  branch?: string;
  company?: { name: string };
  tags: { name: string }[];
  meetings: { timestamp: string; notes?: string }[];
  business_cards: { id: number; filename: string; ocr_text: string | null }[];
}

const ContactDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (id) {
      axios.get(`http://localhost:8000/contacts/${id}`).then(response => {
        setContact(response.data);
      });
    }
  }, [id]);

  if (!contact) return <div>読み込み中...</div>;

  const handleDeleteContact = async () => {
    if (!id || isDeleting) return;
    const confirmed = window.confirm('Delete this contact?');
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await axios.delete(`http://localhost:8000/contacts/${id}`);
      navigate('/contacts');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCard = async (cardId: number) => {
    await axios.delete(`http://localhost:8000/cards/${cardId}`);
    setContact(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        business_cards: prev.business_cards.filter(card => card.id !== cardId),
      };
    });
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{contact.name}</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/contacts')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            一覧へ戻る
          </button>
          <button
            type="button"
            onClick={() => navigate(`/contacts/${contact.id}/edit`)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            編集
          </button>
          <button
            type="button"
            onClick={handleDeleteContact}
            disabled={isDeleting}
            className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            {isDeleting ? '削除中...' : '連絡先を削除'}
          </button>
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg shadow">
        <p><strong>メール:</strong> {contact.email}</p>
        <p><strong>電話:</strong> {contact.phone}</p>
        <p><strong>支店 / Office:</strong> {contact.branch}</p>
        <p><strong>役職・部署:</strong> {contact.role}</p>
        <p><strong>携帯:</strong> {contact.mobile}</p>
        <p><strong>郵便番号:</strong> {contact.postal_code}</p>
        <p><strong>住所:</strong> {contact.address}</p>
        <p><strong>会社:</strong> {contact.company?.name}</p>
        <div className="mt-2">
          <strong>タグ:</strong>
          {contact.tags.map(tag => (
            <span key={tag.name} className="bg-blue-100 text-blue-800 px-2 py-1 rounded mr-1">
              {tag.name}
            </span>
          ))}
        </div>
        <div className="mt-4">
          <h2 className="text-lg font-semibold">ミーティング</h2>
          {contact.meetings.map((meeting, index) => (
            <div key={index} className="border p-2 mt-2">
              <p>{meeting.timestamp}</p>
              <p>{meeting.notes}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <h2 className="text-lg font-semibold">名刺</h2>
          {contact.business_cards.map((card, index) => (
            <div key={card.id} className="border p-2 mt-2">
              <div className="flex items-center justify-between">
                <p>{card.filename}</p>
                <button
                  type="button"
                  onClick={() => handleDeleteCard(card.id)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  削除
                </button>
              </div>
              <p>{card.ocr_text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ContactDetail;
