import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthContext, useAuthProvider } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Sessions } from "./pages/Sessions";
import { Usage } from "./pages/Usage";
import { Security } from "./pages/Security";
import { Config } from "./pages/Config";
import { Tools } from "./pages/Tools";
import { Operations } from "./pages/Operations";
import { Settings } from "./pages/Settings";
import { Instance } from "./pages/Instance";
import { Monitoring } from "./pages/Monitoring";
import { Channels } from "./pages/Channels";

function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider();

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  if (!auth.user) {
    return (
      <AuthContext.Provider value={auth}>
        <Login />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="channels" element={<Channels />} />
            <Route path="usage" element={<Usage />} />
            <Route path="security" element={<Security />} />
            <Route path="config" element={<Config />} />
            <Route path="tools" element={<Tools />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="operations" element={<Operations />} />
            <Route path="instance/:id" element={<Instance />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
