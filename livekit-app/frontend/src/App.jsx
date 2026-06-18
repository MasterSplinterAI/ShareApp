import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect } from 'react'
import HomeScreen from './components/HomeScreen'
import MeetingRoom from './components/MeetingRoom'
import JoinMeeting from './components/JoinMeeting'
import ErrorBoundary from './components/ErrorBoundary'
import V2Layout from './v2/V2Layout'
import V2RootRedirect from './v2/V2RootRedirect'
import V2RequireAuth from './v2/V2RequireAuth'
import V2Login from './v2/pages/V2Login'
import V2Signup from './v2/pages/V2Signup'
import V2AppHome from './v2/pages/V2AppHome'
import V2MeetingsList from './v2/pages/V2MeetingsList'
import V2MeetingDetail from './v2/pages/V2MeetingDetail'
import V2OrgSettings from './v2/pages/V2OrgSettings'
import {
  AdminGate,
  AdminShellLayout,
  AdminOverview,
  AdminOrgsPage,
  AdminUsersPage,
  AdminMeetingsPage,
  AdminCostsPage,
  AdminBillingPage,
  AdminCommsPage,
  AdminSupportPage,
  SuperAdminRedirect,
} from './v2/pages/AdminDashboard'
import { TrendsTab } from './v2/pages/admin/TrendsTab'
import { GuestsTab } from './v2/pages/admin/GuestsTab'
import { AuditTab } from './v2/pages/admin/AuditTab'
import { PlansTab } from './v2/pages/admin/PlansTab'
import V2ResetPassword from './v2/pages/V2ResetPassword'
import TermsPage from './components/legal/TermsPage'
import PrivacyPage from './components/legal/PrivacyPage'
import DomTranslationFallback from './components/DomTranslationFallback'

function App() {
  const location = useLocation();

  // Scroll to anchor targets (e.g. /#pricing from the legal pages) after the
  // SPA route renders; without this, in-app navigation to a hash lands at top.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [location.pathname, location.hash]);

  return (
    <>
      <DomTranslationFallback />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'hsl(var(--card))',
            color: 'hsl(var(--card-foreground))',
            border: '1px solid hsl(var(--border))',
          },
        }}
      />
      <ErrorBoundary>
      <Routes>
        <Route path="/v2" element={<V2Layout />}>
          <Route index element={<V2RootRedirect />} />
          <Route path="login" element={<V2Login />} />
          <Route path="signup" element={<V2Signup />} />
          <Route path="reset-password" element={<V2ResetPassword />} />
          <Route path="app" element={<V2RequireAuth />}>
            <Route index element={<V2AppHome />} />
            <Route path="meetings" element={<V2MeetingsList />} />
            <Route path="meetings/:id" element={<V2MeetingDetail />} />
            <Route path="settings" element={<V2OrgSettings />} />
            <Route path="admin" element={<AdminGate />}>
              <Route element={<AdminShellLayout />}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<AdminOverview />} />
                <Route path="orgs" element={<AdminOrgsPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="plans" element={<PlansTab />} />
                <Route path="meetings" element={<AdminMeetingsPage />} />
                <Route path="trends" element={<TrendsTab />} />
                <Route path="costs" element={<AdminCostsPage />} />
                <Route path="billing" element={<AdminBillingPage />} />
                <Route path="comms" element={<AdminCommsPage />} />
                <Route path="support" element={<AdminSupportPage />} />
                <Route path="guests" element={<GuestsTab />} />
                <Route path="audit" element={<AuditTab />} />
              </Route>
            </Route>
            <Route path="superadmin/*" element={<SuperAdminRedirect />} />
          </Route>
        </Route>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/room/:roomName" element={<MeetingRoom />} />
        <Route path="/join/:roomName" element={<JoinMeeting />} />
        <Route path="*" element={
          <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="text-center text-foreground">
              <h1 className="text-xl font-semibold">404 — Page not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">Current path: {location.pathname}</p>
            </div>
          </div>
        } />
      </Routes>
      </ErrorBoundary>
    </>
  )
}

export default App
