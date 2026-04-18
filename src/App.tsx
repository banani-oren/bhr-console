import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/Dashboard'
import Clients from '@/pages/Clients'
import Transactions from '@/pages/Transactions'
import HoursLog from '@/pages/HoursLog'
import Team from '@/pages/Team'
import Users from '@/pages/Users'
import Portal from '@/pages/Portal'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
    },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">טוען...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Security hotfix (step A): every non-portal admin page requires
  // role='admin'. An invited employee holding a magic-link session
  // must NOT reach any admin route even though Supabase has granted
  // them a valid authenticated JWT. Sign the non-admin session out
  // so Login.tsx does not bounce them back into the redirect loop.
  if (profile?.role !== 'admin') {
    return <NonAdminBlocker />
  }

  return <Layout>{children}</Layout>
}

function NonAdminBlocker() {
  useEffect(() => {
    supabase.auth.signOut()
  }, [])
  return (
    <div className="min-h-screen flex items-center justify-center" dir="rtl">
      <div className="text-center space-y-2">
        <p className="text-muted-foreground">אין הרשאה. מפנה להתחברות…</p>
      </div>
    </div>
  )
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth()

  if (profile?.role !== 'admin') {
    return <NonAdminBlocker />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/portal" element={<Portal />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/clients"
              element={
                <ProtectedRoute>
                  <Clients />
                </ProtectedRoute>
              }
            />
            <Route path="/agreements" element={<Navigate to="/clients" replace />} />
            <Route
              path="/transactions"
              element={
                <ProtectedRoute>
                  <Transactions />
                </ProtectedRoute>
              }
            />
            <Route
              path="/hours"
              element={
                <ProtectedRoute>
                  <HoursLog />
                </ProtectedRoute>
              }
            />
            <Route
              path="/team"
              element={
                <ProtectedRoute>
                  <Team />
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute>
                  <AdminRoute>
                    <Users />
                  </AdminRoute>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
