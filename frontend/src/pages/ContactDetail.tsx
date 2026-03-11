import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
  first_met_at?: string;
  branch?: string;
  company?: { name: string };
  tags: { name: string; type?: string }[];
  notes?: string;
  meetings: { timestamp: string; notes?: string }[];
  business_cards: { id: number; filename: string; ocr_text: string | null }[];
  is_self?: boolean;
}

const ContactDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [contact, setContact] = useState<Contact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(
    (location.state as { flash?: string } | null)?.flash || null,
  );

  useEffect(() => {
    if (!flashMessage) return;
    const timer = window.setTimeout(() => {
      setFlashMessage(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [flashMessage]);

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

  const handleSelfToggle = async (checked: boolean) => {
    if (!id) return;
    try {
      const response = await axios.put(`http://localhost:8000/contacts/${id}/self`, { is_self: checked });
      setContact(response.data);
    } catch {
      // no-op
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">
          {contact.name}
          <span className="ml-3 text-sm font-normal text-gray-500">
            初回:{' '}
            {contact.first_met_at ? contact.first_met_at : '-'}
          </span>
        </h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const companyName = contact.company?.name?.trim() || '未設定';
              sessionStorage.setItem('contacts:lastCompany', companyName);
              navigate('/contacts', { state: { openCompany: companyName } });
            }}
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
      <div className="mb-3 flex items-center gap-2 text-sm text-gray-700">
        <input
          id="is-self"
          type="checkbox"
          checked={Boolean(contact.is_self)}
          onChange={event => handleSelfToggle(event.target.checked)}
        />
        <label htmlFor="is-self">自分</label>
      </div>
      {flashMessage && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {flashMessage}
        </div>
      )}
      <div className="bg-white p-4 rounded-lg shadow">
        <p><strong>メール:</strong> {contact.email}</p>
        <p><strong>電話:</strong> {contact.phone}</p>
        <p><strong>支店 / Office:</strong> {contact.branch}</p>
        <p>
          <strong>役職・部署:</strong>{' '}
          <span className="font-medium text-emerald-700">{contact.role}</span>
        </p>
        <p><strong>携帯:</strong> {contact.mobile}</p>
        <p><strong>初回:</strong> {contact.first_met_at || '-'}</p>
        <p><strong>郵便番号:</strong> {contact.postal_code}</p>
        <p><strong>住所:</strong> {contact.address}</p>
        <p><strong>会社:</strong> {contact.company?.name}</p>
        <p><strong>メモ:</strong> {contact.notes || '-'}</p>
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
