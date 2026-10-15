import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { MeetingRoom } from './pages/MeetingRoom';
import { MeetingEnd } from './pages/MeetingEnd';
import { Login } from './pages/Login';
import { useAuthStore } from './store/authStore';

/** Gate protected routes — bounce to /login when there is no token. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  // Rehydrate the authenticated user from the stored token on first load.
  const loadMe = useAuthStore((s) => s.loadMe);
  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/meeting/:roomId" element={<RequireAuth><MeetingRoom /></RequireAuth>} />
        <Route path="/meeting/:roomId/end" element={<RequireAuth><MeetingEnd /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
