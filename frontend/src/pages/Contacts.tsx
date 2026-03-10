import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';

interface Contact {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: { name: string };
  tags: { name: string; type?: string }[];
  first_met_at?: string;
  notes?: string;
}

const Contacts: React.FC = () => {
  const location = useLocation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});

  useEffect(() => {
    axios.get('http://localhost:8000/contacts/').then(response => {
      const nextContacts = response.data as Contact[];
      setContacts(nextContacts);
      const initialExpanded: Record<string, boolean> = {};
      nextContacts.forEach(contact => {
        const name = contact.company?.name?.trim() || '未設定';
        if (!(name in initialExpanded)) {
          initialExpanded[name] = false;
        }
      });
      const storedCompany = (location.state as { openCompany?: string } | null)?.openCompany
        || sessionStorage.getItem('contacts:lastCompany');
      if (storedCompany && storedCompany in initialExpanded) {
        initialExpanded[storedCompany] = true;
      }
      setExpandedCompanies(initialExpanded);
    });
  }, [location.state]);

  const companyGroups = useMemo(() => {
    const grouped = new Map<string, Contact[]>();
    contacts.forEach(contact => {
      const name = contact.company?.name?.trim() || '未設定';
      if (!grouped.has(name)) {
        grouped.set(name, []);
      }
      grouped.get(name)?.push(contact);
    });
    const entries = Array.from(grouped.entries()).map(([company, items]) => {
      const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      return { company, contacts: sorted };
    });
    entries.sort((a, b) => {
      if (a.company === '未設定') return 1;
      if (b.company === '未設定') return -1;
      return a.company.localeCompare(b.company, 'ja');
    });
    return entries;
  }, [contacts]);

  const toggleCompany = (company: string) => {
    setExpandedCompanies(prev => ({
      ...prev,
      [company]: !prev[company],
    }));
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">連絡先</h1>
      <div className="space-y-4">
        {companyGroups.map(group => {
          const expanded = expandedCompanies[group.company] ?? true;
          return (
            <div key={group.company} className="bg-white rounded-lg shadow border border-gray-200">
              <button
                type="button"
                onClick={() => toggleCompany(group.company)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              >
                <div>
                  <p className="text-xs text-gray-500">会社</p>
                  <h2 className="text-lg font-semibold">{group.company}</h2>
                </div>
                <div className="text-sm text-gray-600">
                  {group.contacts.length}件 {expanded ? '▲' : '▼'}
                </div>
              </button>
              {expanded && (
                <div className="border-t border-gray-200 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.contacts.map(contact => (
                    <Link
                      key={contact.id}
                      to={`/contacts/${contact.id}`}
                      onClick={() => {
                        sessionStorage.setItem('contacts:lastCompany', group.company);
                      }}
                      className="bg-white p-4 rounded-lg shadow hover:shadow-lg transition border border-gray-100"
                    >
                      <h3 className="text-lg font-semibold">{contact.name}</h3>
                      <p className="text-sm font-medium text-emerald-700">{contact.role || '-'}</p>
                      <p className="text-xs text-gray-500">
                        初回: {contact.first_met_at ? contact.first_met_at : '-'}
                      </p>
                      <p>{contact.email}</p>
                      <p>{contact.phone}</p>
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Contacts;
