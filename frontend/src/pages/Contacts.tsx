import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

interface Contact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  company?: { name: string };
  tags: { name: string }[];
}

const Contacts: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    axios.get('http://localhost:8000/contacts/').then(response => {
      setContacts(response.data);
    });
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">連絡先</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {contacts.map(contact => (
          <Link key={contact.id} to={`/contacts/${contact.id}`} className="bg-white p-4 rounded-lg shadow hover:shadow-lg transition">
            <h2 className="text-lg font-semibold">{contact.name}</h2>
            <p>{contact.email}</p>
            <p>{contact.phone}</p>
            <p>{contact.company?.name}</p>
            <div className="mt-2">
              {contact.tags.map(tag => (
                <span key={tag.name} className="bg-blue-100 text-blue-800 px-2 py-1 rounded mr-1">
                  {tag.name}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default Contacts;
