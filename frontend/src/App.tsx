import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import TechnologySearch from './pages/TechnologySearch';
import CardUpload from './pages/CardUpload';
import ContactRegister from './pages/ContactRegister';
import NetworkGraph from './pages/NetworkGraph';
import EventRegister from './pages/EventRegister';

function App() {
  return (
    <Router>
      <div className="flex">
        <Sidebar />
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/contacts" element={<Contacts />} />
            <Route path="/contacts/:id" element={<ContactDetail />} />
            <Route path="/contacts/:id/edit" element={<ContactRegister />} />
            <Route path="/contacts/register" element={<ContactRegister />} />
            <Route path="/technology-search" element={<TechnologySearch />} />
            <Route path="/card-upload" element={<CardUpload />} />
            <Route path="/network" element={<NetworkGraph />} />
            <Route path="/events" element={<EventRegister />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
