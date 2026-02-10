import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ApiProvider } from './context/ApiContext';
import './styles/variables.css';
import './styles/components.css';
import './styles/dialogs.css';
import './styles/dashboard.css';
import './styles/profile.css';
import './styles/chat-modal.css';
import './styles/admin.css';
import './styles/auth.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ApiProvider>
        <App />
      </ApiProvider>
    </BrowserRouter>
  </React.StrictMode>,
);