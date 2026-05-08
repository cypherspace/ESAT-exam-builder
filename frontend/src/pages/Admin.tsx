import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';

type Role = 'admin' | 'teacher' | 'student';

export function Admin() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const data = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.admin.listUsers(),
    enabled: me.data?.role === 'admin',
  });

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('teacher');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    setError(null);
  };

  const add = useMutation({
    mutationFn: () => api.admin.addInvite(newEmail.trim().toLowerCase(), newRole),
    onSuccess: () => {
      setNewEmail('');
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });
  const remove = useMutation({
    mutationFn: (email: string) => api.admin.removeInvite(email),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api.admin.setUserRole(id, role),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.admin.deleteUser(id),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  if (me.data && me.data.role !== 'admin') {
    return (
      <div className="p-6 text-sm text-slate-600">
        Admin access required. Signed in as <strong>{me.data.email}</strong> ({me.data.role}).
      </div>
    );
  }

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-2 overflow-auto p-2">
      <section className="rounded border bg-white shadow-sm">
        <header className="flex items-center justify-between bg-purple-700 px-3 py-2 text-white">
          <h2 className="font-semibold">Invite a new user</h2>
        </header>
        <form
          className="flex flex-wrap items-end gap-2 p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (newEmail.trim()) add.mutate();
          }}
        >
          <label className="grid gap-1">
            <span className="text-xs text-slate-600">Email</span>
            <input
              type="email"
              required
              className="w-72 rounded border px-2 py-1"
              placeholder="someone@ucs.org.uk"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-slate-600">Role</span>
            <select
              className="rounded border px-2 py-1"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
            >
              <option value="teacher">teacher</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1 text-white disabled:bg-slate-400"
            disabled={add.isPending || !newEmail.trim()}
          >
            {add.isPending ? 'Adding…' : '+ Invite'}
          </button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </form>
      </section>

      <section className="grid min-h-0 grid-cols-1 gap-2 lg:grid-cols-2">
        <article className="flex min-h-0 flex-col rounded border bg-white shadow-sm">
          <header className="flex items-center justify-between bg-purple-700 px-3 py-2 text-white">
            <h2 className="font-semibold">Signed-in users</h2>
            <span className="text-xs opacity-80">{data.data?.users.length ?? 0}</span>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-1 text-left">Email</th>
                  <th className="px-3 py-1 text-left">Role</th>
                  <th className="px-3 py-1 text-left">Last login</th>
                  <th className="px-3 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.data?.users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-1">
                      <div>{u.email}</div>
                      {u.display_name && (
                        <div className="text-xs text-slate-500">{u.display_name}</div>
                      )}
                    </td>
                    <td className="px-3 py-1">
                      <select
                        className="rounded border px-1 py-0.5 text-xs"
                        value={u.role}
                        disabled={u.id === me.data?.id || setRole.isPending}
                        onChange={(e) =>
                          setRole.mutate({ id: u.id, role: e.target.value as Role })
                        }
                      >
                        <option value="teacher">teacher</option>
                        <option value="admin">admin</option>
                        <option value="student">student</option>
                      </select>
                    </td>
                    <td className="px-3 py-1 text-xs text-slate-500">
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <button
                        className="text-xs text-red-600 hover:underline disabled:opacity-40"
                        disabled={u.id === me.data?.id}
                        title={
                          u.id === me.data?.id ? "Can't remove yourself" : 'Remove user'
                        }
                        onClick={() => {
                          if (confirm(`Remove ${u.email}?`)) del.mutate(u.id);
                        }}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="flex min-h-0 flex-col rounded border bg-white shadow-sm">
          <header className="flex items-center justify-between bg-purple-700 px-3 py-2 text-white">
            <h2 className="font-semibold">Pending invites</h2>
            <span className="text-xs opacity-80">{data.data?.invites.length ?? 0}</span>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-1 text-left">Email</th>
                  <th className="px-3 py-1 text-left">Role</th>
                  <th className="px-3 py-1 text-left">Added by</th>
                  <th className="px-3 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.data?.invites.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-sm text-slate-500">
                      No pending invites — all listed users have signed in at least once.
                    </td>
                  </tr>
                )}
                {data.data?.invites.map((i) => (
                  <tr key={i.email}>
                    <td className="px-3 py-1">{i.email}</td>
                    <td className="px-3 py-1 text-xs">{i.role}</td>
                    <td className="px-3 py-1 text-xs text-slate-500">
                      {i.added_by_email ?? '—'}
                    </td>
                    <td className="px-3 py-1 text-right">
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => {
                          if (confirm(`Revoke invite for ${i.email}?`)) {
                            remove.mutate(i.email);
                          }
                        }}
                      >
                        revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
