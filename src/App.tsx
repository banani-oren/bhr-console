import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/lib/auth'
import RequireRole from '@/components/RequireRole'
import Login from '@/pages/Login'
import SetPassword from '@/pages/SetPassword'
import Dashboard from '@/pages/Dashboard'
import Clients from '@/pages/Clients'
import Transactions from '@/pages/Transactions'
import HoursPage from '@/pages/hours/HoursPage'
import Team from '@/pages/Team'
import Users from '@/pages/Users'
import Services from '@/pages/Services'
import BillingReports from '@/pages/BillingReports'
import Bonuses from '@/pages/Bonuses'
import Profile from '@/pages/Profile'
import MobileShell from '@/pages/mobile/MobileShell'
import MobileHours from '@/pages/mobile/MobileHours'
import MobileProfile from '@/pages/mobile/MobileProfile'
import MobileAutoRoute from '@/components/MobileAutoRoute'

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
          <MobileAutoRoute />
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
                  <HoursPage />
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
              path="/services"
              element={
                <RequireRole allow={['admin']}>
                  <Services />
                </RequireRole>
              }
            />
            {/* Legacy /hours/report route — the report is now a dialog inside
                the rebuilt /hours admin tab; redirect old bookmarks. */}
            <Route path="/hours/report" element={<Navigate to="/hours" replace />} />
            <Route
              path="/billing-reports"
              element={
                <RequireRole allow={['admin', 'administration']}>
                  <BillingReports />
                </RequireRole>
              }
            />
            <Route
              path="/bonuses"
              element={
                <RequireRole allow={['admin']}>
                  <Bonuses />
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
            {/* Batch 5 Phase C: mobile is scoped to hours-only. The
                /m/transactions route from batch 4 is removed — phones never
                need the admin transactions surface. withLayout={false}
                guarantees no admin sidebar leaks into MobileShell. */}
            <Route
              path="/m"
              element={
                <RequireRole allow={['admin', 'administration', 'recruiter']} withLayout={false}>
                  <MobileShell />
                </RequireRole>
              }
            >
              <Route index element={<Navigate to="/m/hours" replace />} />
              <Route path="hours" element={<MobileHours />} />
              <Route path="profile" element={<MobileProfile />} />
              {/* Legacy mobile transactions route → redirect to hours. */}
              <Route path="transactions" element={<Navigate to="/m/hours" replace />} />
            </Route>
            <Route path="/portal" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
