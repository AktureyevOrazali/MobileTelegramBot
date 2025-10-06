import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from './context/SessionContext';
import { FeedbackProvider } from './context/FeedbackContext';
import AuthPage from './pages/AuthPage';
import ChatLayout from './pages/ChatLayout';
import ChatDetailPage from './pages/ChatDetailPage';
import DashboardHome from './pages/DashboardHome';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';

const ProtectedRoutes = () => {
  const { session } = useSession();

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <Routes>
      <Route element={<ChatLayout />}> 
        <Route index element={<DashboardHome />} />
        <Route path="chats" element={<DashboardHome />} />
        <Route path="chats/:chatId" element={<ChatDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
};

const App = () => {
  return (
    <FeedbackProvider>
      <SessionProvider>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </SessionProvider>
    </FeedbackProvider>
  );
};

export default App;
