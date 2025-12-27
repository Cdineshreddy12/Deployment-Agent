import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import { Toaster } from '../ui/toaster';

const Layout = () => {
  const location = useLocation();
  const isFullWidthPage = location.pathname.startsWith('/chat');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className={isFullWidthPage ? "flex-1 overflow-hidden" : "container mx-auto px-4 py-8 flex-1"}>
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
};

export default Layout;
