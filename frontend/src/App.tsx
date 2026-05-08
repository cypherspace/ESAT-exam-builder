import { NavLink, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Library } from './pages/Library';
import { Builder } from './pages/Builder';
import { Upload } from './pages/Upload';
import { Login } from './pages/Login';
import { Edit } from './pages/Edit';
import { Drafts } from './pages/Drafts';
import { Generate } from './pages/Generate';
import { Admin } from './pages/Admin';
import { api } from './lib/api';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 bg-blue-600 px-4 py-2 text-white">
        <h1 className="text-lg font-semibold">ESAT Exam Builder</h1>
        <nav className="flex gap-3 text-sm">
          <NavLink to="/" end className={navClass}>
            Builder
          </NavLink>
          <NavLink to="/generate" className={navClass}>
            Generate
          </NavLink>
          <NavLink to="/library" className={navClass}>
            Library
          </NavLink>
          <NavLink to="/drafts" className={navClass}>
            Drafts
          </NavLink>
          <NavLink to="/upload" className={navClass}>
            Upload
          </NavLink>
          {me.data?.role === 'admin' && (
            <NavLink to="/admin" className={navClass}>
              Admin
            </NavLink>
          )}
        </nav>
        {me.data && (
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="opacity-90">{me.data.email}</span>
            <button
              onClick={async () => {
                await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/v1/auth/logout`, {
                  method: 'POST',
                  credentials: 'include',
                });
                window.location.href = '/login?manual=1';
              }}
              className="rounded bg-blue-700 px-2 py-1 text-xs hover:bg-blue-800"
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Builder />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/builder/:draftId" element={<Builder />} />
          <Route path="/library" element={<Library />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/edit/:questionId" element={<Edit />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'underline underline-offset-4' : 'opacity-80 hover:opacity-100';
}
