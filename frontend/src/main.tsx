import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient();

// On 401 the api client dispatches `esat:unauthorized`; bounce to /login
// where the OAuth start link or auto-redirect kicks in.
window.addEventListener('esat:unauthorized', () => {
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
