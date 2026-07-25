import { Routes, Route, useLocation, Navigate, Link } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, lazy, Suspense } from 'react'
import SeoHead from './components/SeoHead'
import HomeScreen from './components/HomeScreen'
import ErrorBoundary from './components/ErrorBoundary'
import DomTranslationFallback from './components/DomTranslationFallback'

const MeetingRoom = lazy(() => import('./components/MeetingRoom'))
const JoinMeeting = lazy(() => import('./components/JoinMeeting'))
const TermsPage = lazy(() => import('./components/legal/TermsPage'))
const PrivacyPage = lazy(() => import('./components/legal/PrivacyPage'))
const TranslationLabDemo = lazy(() => import('./components/demo/TranslationLabDemo'))

const V2Layout = lazy(() => import('./v2/V2Layout'))
const V2RootRedirect = lazy(() => import('./v2/V2RootRedirect'))
const V2RequireAuth = lazy(() => import('./v2/V2RequireAuth'))
const V2Login = lazy(() => import('./v2/pages/V2Login'))
const V2Signup = lazy(() => import('./v2/pages/V2Signup'))
const V2ResetPassword = lazy(() => import('./v2/pages/V2ResetPassword'))
const V2AppHome = lazy(() => import('./v2/pages/V2AppHome'))
const V2MeetingsList = lazy(() => import('./v2/pages/V2MeetingsList'))
const V2MeetingDetail = lazy(() => import('./v2/pages/V2MeetingDetail'))
const V2OrgSettings = lazy(() => import('./v2/pages/V2OrgSettings'))

const AdminGate = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminGate }))
)
const AdminShellLayout = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminShellLayout }))
)
const AdminOverview = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminOverview }))
)
const AdminOrgsPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminOrgsPage }))
)
const AdminUsersPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminUsersPage }))
)
const AdminMeetingsPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminMeetingsPage }))
)
const AdminCostsPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminCostsPage }))
)
const AdminBillingPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminBillingPage }))
)
const AdminCommsPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminCommsPage }))
)
const AdminStoragePage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminStoragePage }))
)
const AdminSupportPage = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminSupportPage }))
)
const SuperAdminRedirect = lazy(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.SuperAdminRedirect }))
)
const TrendsTab = lazy(() =>
  import('./v2/pages/admin/TrendsTab').then((m) => ({ default: m.TrendsTab }))
)
const GuestsTab = lazy(() =>
  import('./v2/pages/admin/GuestsTab').then((m) => ({ default: m.GuestsTab }))
)
const AuditTab = lazy(() =>
  import('./v2/pages/admin/AuditTab').then((m) => ({ default: m.AuditTab }))
)
const PlansTab = lazy(() =>
  import('./v2/pages/admin/PlansTab').then((m) => ({ default: m.PlansTab }))
)

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-background text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

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
      <SeoHead />
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
      <Suspense fallback={<RouteFallback />}>
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
                <Route path="storage" element={<AdminStoragePage />} />
                <Route path="support" element={<AdminSupportPage />} />
                <Route path="guests" element={<GuestsTab />} />
                <Route path="audit" element={<AuditTab />} />
              </Route>
            </Route>
            <Route path="superadmin/*" element={<SuperAdminRedirect />} />
          </Route>
        </Route>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/demo" element={<TranslationLabDemo />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/room/:roomName" element={<MeetingRoom />} />
        <Route path="/join/:roomName" element={<JoinMeeting />} />
        <Route path="*" element={
          <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="text-center text-foreground">
              <h1 className="text-xl font-semibold">404 — Page not found</h1>
              <p className="mt-2 text-sm text-muted-foreground">Current path: {location.pathname}</p>
              <Link
                to="/"
                className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Go to home
              </Link>
            </div>
          </div>
        } />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </>
  )
}

export default App
