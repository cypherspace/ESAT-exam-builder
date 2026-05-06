import { NavLink, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Library } from './pages/Library';
import { Builder } from './pages/Builder';
import { Upload } from './pages/Upload';
import { Login } from './pages/Login';
import { Edit } from './pages/Edit';
import { Drafts } from './pages/Drafts';
import { Generate } from './pages/Generate';
import { api } from './lib/api';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-6">
        <h1 className="font-semibold">ESAT Exam Builder</h1>
        <nav className="flex gap-4 text-sm flex-1">
          <NavLink to="/" end className={navClass}>Library</NavLink>
          <NavLink to="/drafts" className={navClass}>Drafts</NavLink>
          <NavLink to="/builder" className={navClass}>Builder</NavLink>
          <NavLink to="/generate" className={navClass}>Generate</NavLink>
          <NavLink to="/upload" className={navClass}>Upload</NavLink>
        </nav>
        {me.data && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>{me.data.email}</span>
            <button
              onClick={async () => {
                await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
                window.location.href = '/login?manual=1';
              }}
              className="text-blue-600 hover:underline"
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="flex-1 p-6">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/builder/:draftId" element={<Builder />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/edit/:questionId" element={<Edit />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'text-blue-600 font-medium'
    : 'text-slate-600 hover:text-slate-900';
}
