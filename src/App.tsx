import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/lib/auth'
import RequireRole from '@/components/RequireRole'
import Login from '@/pages/Login'
import SetPassword from '@/pages/SetPassword'
import Dashboard from '@/pages/Dashboard'
import Clients from '@/pages/Clients'
import Transactions from '@/pages/Transactions'
import HoursLog from '@/pages/HoursLog'
import Team from '@/pages/Team'
import Users from '@/pages/Users'
import Profile from '@/pages/Profile'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route
              path="/"
              element={
                <RequireRole allow={['admin', 'administration', 'recruiter']}>
                  <Dashboard />
                </RequireRole>
              }
            />
            <Route
              path="/clients"
              element={
                <RequireRole allow={['admin', 'administration']}>
                  <Clients />
                </RequireRole>
              }
            />
            <Route path="/agreements" element={<Navigate to="/clients" replace />} />
            <Route
              path="/transactions"
              element={
                <RequireRole allow={['admin', 'administration', 'recruiter']}>
                  <Transactions />
                </RequireRole>
              }
            />
            <Route
              path="/hours"
              element={
                <RequireRole allow={['admin', 'administration', 'recruiter']}>
                  <HoursLog />
                </RequireRole>
              }
            />
            <Route
              path="/team"
              element={
                <RequireRole allow={['admin']}>
                  <Team />
                </RequireRole>
              }
            />
            <Route
              path="/users"
              element={
                <RequireRole allow={['admin']}>
                  <Users />
                </RequireRole>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireRole allow={['admin', 'administration', 'recruiter']}>
                  <Profile />
                </RequireRole>
              }
            />
            <Route path="/portal" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
