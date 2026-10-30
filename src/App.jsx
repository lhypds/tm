import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "@pages/Home";
import Login from "@pages/Login";
import { Toast } from "@ui";
import { AuthProvider, useAuth } from "@store";
import { useTextKeys } from "@utils/keys";

// The task pages only mount once someone is logged in: they load the spaces on mount, and
// without a session that request would be refused anyway.
function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Login />;
  return (
    <BrowserRouter>
      <Routes>
        {/* The root shows every origin's tasks; /all, the old path for that, falls through to it below. */}
        <Route path="/" element={<Home all />} />
        <Route path="/o/:origin/:work/:repository" element={<Home />} />
        <Route path="/o/:origin/:work" element={<Home />} />
        <Route path="/o/:origin" element={<Home />} />
        {/* Kept for old bookmarks and works that do not belong to an origin. */}
        <Route path="/w/:work" element={<Home />} />
        <Route path="/w/:work/:repository" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  useTextKeys();
  return (
    <AuthProvider>
      <Gate />
      <Toast />
    </AuthProvider>
  );
}
