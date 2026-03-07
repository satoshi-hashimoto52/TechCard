import React, { useState } from 'react';
import axios from 'axios';

interface Contact {
  id: number;
  name: string;
  email?: string;
  tags: { name: string }[];
}

const TechnologySearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);

  const search = () => {
    axios.get(`http://localhost:8000/contacts/`).then(response => {
      const filtered = response.data.filter((contact: Contact) =>
        contact.tags.some(tag => tag.name.toLowerCase().includes(query.toLowerCase()))
      );
      setContacts(filtered);
    });
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">技術検索</h1>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="技術名で検索"
        className="border p-2 mb-4 w-full"
      />
      <button onClick={search} className="bg-blue-500 text-white px-4 py-2 rounded">検索</button>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        {contacts.map(contact => (
          <div key={contact.id} className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold">{contact.name}</h2>
            <p>{contact.email}</p>
            <div>
              {contact.tags.map(tag => (
                <span key={tag.name} className="bg-green-100 text-green-800 px-2 py-1 rounded mr-1">
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TechnologySearch;
