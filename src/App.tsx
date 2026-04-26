import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import Results from './pages/Results';
import History from './pages/History';
import Database from './pages/Database';
import TestCases from './pages/TestCases';
import VectorManager from './pages/VectorManager';
import NASBrowser from './pages/NASBrowser';
import VehicleScores from './pages/VehicleScores';
import DrBeeLab from './pages/DrBeeLab';
import DrBeeSessions from './pages/DrBeeSessions';
import AskBeeEval from './components/AskBeeEval';
import { LanguageProvider } from './contexts/LanguageContext';

function App() {
  return (
    <LanguageProvider>
      <Router>
        <div className="flex h-screen bg-slate-50 font-sans text-slate-900">
          <Sidebar />
          <main className="flex-1 overflow-auto relative">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/results/:id" element={<Results />} />
              <Route path="/history" element={<History />} />
              <Route path="/database" element={<Database />} />
              <Route path="/test-cases" element={<TestCases />} />
              <Route path="/vector-manager" element={<VectorManager />} />
              <Route path="/nas" element={<NASBrowser />} />
              <Route path="/vehicle-scores" element={<VehicleScores />} />
              <Route path="/drbee" element={<DrBeeLab />} />
              <Route path="/drbee/sessions" element={<DrBeeSessions />} />
              <Route path="/settings" element={<div className="p-8">Settings (Coming Soon)</div>} />
            </Routes>
            <AskBeeEval />
          </main>
        </div>
      </Router>
    </LanguageProvider>
  );
}

export default App;
