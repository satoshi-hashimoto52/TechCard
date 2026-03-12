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
import CompanyGroups from './pages/CompanyGroups';
import CompanyDetail from './pages/CompanyDetail';
import EventDetail from './pages/EventDetail';
import Insights from './pages/Insights';
import Timeline from './pages/Timeline';

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
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/company-groups" element={<CompanyGroups />} />
            <Route path="/company/:id" element={<CompanyDetail />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/timeline" element={<Timeline />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
