import { NavLink, Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { Builder } from './pages/Builder';
import { Upload } from './pages/Upload';
import { Login } from './pages/Login';
import { Edit } from './pages/Edit';
import { Drafts } from './pages/Drafts';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-6">
        <h1 className="font-semibold">ESAT Exam Builder</h1>
        <nav className="flex gap-4 text-sm">
          <NavLink to="/" end className={navClass}>Library</NavLink>
          <NavLink to="/drafts" className={navClass}>Drafts</NavLink>
          <NavLink to="/builder" className={navClass}>Builder</NavLink>
          <NavLink to="/upload" className={navClass}>Upload</NavLink>
        </nav>
      </header>
      <main className="flex-1 p-6">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/builder/:draftId" element={<Builder />} />
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
