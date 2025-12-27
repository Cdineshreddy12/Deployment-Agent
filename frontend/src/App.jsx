import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Common/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Deployments from './pages/Deployments';
import DeploymentDetail from './pages/DeploymentDetail';
import Settings from './pages/Settings';
import Credentials from './pages/Credentials';
import NewDeployment from './pages/NewDeployment';
import DeploymentWorkspace from './pages/DeploymentWorkspace';

const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          {/* Standalone full-screen routes */}
          <Route 
            path="/chat" 
            element={
              <PrivateRoute>
                <Chat />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/chat/:deploymentId" 
            element={
              <PrivateRoute>
                <Chat />
              </PrivateRoute>
            } 
          />

          {/* Deployment Workspace - Full screen */}
          <Route 
            path="/workspace" 
            element={
              <PrivateRoute>
                <DeploymentWorkspace />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/workspace/:id" 
            element={
              <PrivateRoute>
                <DeploymentWorkspace />
              </PrivateRoute>
            } 
          />

          {/* Main layout routes */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="deployments" element={<Deployments />} />
            <Route path="deployments/new" element={<NewDeployment />} />
            <Route path="deployments/:id" element={<DeploymentDetail />} />
            <Route path="settings" element={<Settings />} />
            <Route path="credentials" element={<Credentials />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
