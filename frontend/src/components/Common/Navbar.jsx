import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../ui/button';
import { Zap, LogOut, Settings, LayoutDashboard, MessageSquare, Server, Key, Plus, Rocket } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';

const Navbar = () => {
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = async () => {
    await logout();
    toast({
      title: "Logged out",
      description: "You have been successfully logged out",
    });
    navigate('/login');
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 font-bold text-xl">
              <Zap className="h-6 w-6 text-primary" />
              <span>Deployment Agent</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link to="/">
                <Button variant="ghost" size="sm">
                  <LayoutDashboard className="h-4 w-4 mr-2" />
                  Dashboard
                </Button>
              </Link>
              <Link to="/chat">
                <Button variant="ghost" size="sm">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Chat
                </Button>
              </Link>
              <Link to="/deployments">
                <Button variant="ghost" size="sm">
                  <Server className="h-4 w-4 mr-2" />
                  Deployments
                </Button>
              </Link>
              <Link to="/workspace">
                <Button variant="ghost" size="sm">
                  <Rocket className="h-4 w-4 mr-2" />
                  Workspace
                </Button>
              </Link>
              <Link to="/deployments/new">
                <Button variant="default" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Deployment
                </Button>
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/credentials">
              <Button variant="ghost" size="sm">
                <Key className="h-4 w-4 mr-2" />
                Credentials
              </Button>
            </Link>
            <Link to="/settings">
              <Button variant="ghost" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-medium text-primary">
                {user?.name?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
