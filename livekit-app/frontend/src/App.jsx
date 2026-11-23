import { Routes, Route, useLocation, Navigate, Link } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, Suspense } from 'react'
import SeoHead from './components/SeoHead'
import HomeScreen from './components/HomeScreen'
import ErrorBoundary from './components/ErrorBoundary'
import DomTranslationFallback from './components/DomTranslationFallback'
import NativeAppBridge from './components/NativeAppBridge'
import { lazyWithRetry } from './lib/lazyWithRetry'

const MeetingRoom = lazyWithRetry(() => import('./components/MeetingRoom'), 'MeetingRoom')
const JoinMeeting = lazyWithRetry(() => import('./components/JoinMeeting'), 'JoinMeeting')
const TermsPage = lazyWithRetry(() => import('./components/legal/TermsPage'), 'TermsPage')
const PrivacyPage = lazyWithRetry(() => import('./components/legal/PrivacyPage'), 'PrivacyPage')
const TranslationLabDemo = lazyWithRetry(() => import('./components/demo/TranslationLabDemo'), 'TranslationLabDemo')
const PreviewStaticRedirect = lazyWithRetry(() => import('./components/preview/PreviewStaticRedirect'), 'PreviewStaticRedirect')

const V2Layout = lazyWithRetry(() => import('./v2/V2Layout'), 'V2Layout')
const V2RootRedirect = lazyWithRetry(() => import('./v2/V2RootRedirect'), 'V2RootRedirect')
const V2RequireAuth = lazyWithRetry(() => import('./v2/V2RequireAuth'), 'V2RequireAuth')
const V2Login = lazyWithRetry(() => import('./v2/pages/V2Login'), 'V2Login')
const V2Signup = lazyWithRetry(() => import('./v2/pages/V2Signup'), 'V2Signup')
const V2ResetPassword = lazyWithRetry(() => import('./v2/pages/V2ResetPassword'), 'V2ResetPassword')
const V2AppHome = lazyWithRetry(() => import('./v2/pages/V2AppHome'), 'V2AppHome')
const V2CallsPage = lazyWithRetry(() => import('./v2/pages/V2CallsPage'), 'V2CallsPage')
const V2MeetingsList = lazyWithRetry(() => import('./v2/pages/V2MeetingsList'), 'V2MeetingsList')
const V2MeetingDetail = lazyWithRetry(() => import('./v2/pages/V2MeetingDetail'), 'V2MeetingDetail')
const V2NotetakerPage = lazyWithRetry(() => import('./v2/pages/V2NotetakerPage'), 'V2NotetakerPage')
const V2OrgSettings = lazyWithRetry(() => import('./v2/pages/V2OrgSettings'), 'V2OrgSettings')

function SearchAwareRedirect({ to }) {
  const { search, hash } = useLocation()
  return <Navigate to={`${to}${search || ''}${hash || ''}`} replace />
}
function AppSubpathRedirect() {
  const { pathname, search, hash } = useLocation()
  const sub = pathname.replace(/^\/app\/?/, '')
  const target = sub ? `/v2/app/${sub}` : '/v2/app'
  return <Navigate to={`${target}${search || ''}${hash || ''}`} replace />
}
function V2MeetingsSubpathRedirect() {
  const { pathname, search, hash } = useLocation()
  const sub = pathname.replace(/^\/v2\/meetings\/?/, '')
  const target = sub ? `/v2/app/meetings/${sub}` : '/v2/app/meetings'
  return <Navigate to={`${target}${search || ''}${hash || ''}`} replace />
}
function BlogStaticRedirect() {
  const { pathname, search, hash } = useLocation()
  useEffect(() => {
    if (pathname.endsWith('.html')) return
    window.location.replace(`${pathname.replace(/\/$/, '')}/index.html${search || ''}${hash || ''}`)
  }, [pathname, search, hash])
  return null
}

const AdminGate = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminGate })), 'AdminGate'
)
const AdminShellLayout = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminShellLayout })), 'AdminShellLayout'
)
const AdminOverview = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminOverview })), 'AdminOverview'
)
const AdminOrgsPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminOrgsPage })), 'AdminOrgsPage'
)
const AdminUsersPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminUsersPage })), 'AdminUsersPage'
)
const AdminMeetingsPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminMeetingsPage })), 'AdminMeetingsPage'
)
const AdminCostsPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminCostsPage })), 'AdminCostsPage'
)
const AdminBillingPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminBillingPage })), 'AdminBillingPage'
)
const AdminCommsPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminCommsPage })), 'AdminCommsPage'
)
const AdminStoragePage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminStoragePage })), 'AdminStoragePage'
)
const AdminSupportPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminSupportPage })), 'AdminSupportPage'
)
const AdminMarketingPage = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.AdminMarketingPage })), 'AdminMarketingPage'
)
const SuperAdminRedirect = lazyWithRetry(() =>
  import('./v2/pages/AdminDashboard').then((m) => ({ default: m.SuperAdminRedirect })), 'SuperAdminRedirect'
)
const TrendsTab = lazyWithRetry(() =>
  import('./v2/pages/admin/TrendsTab').then((m) => ({ default: m.TrendsTab })), 'TrendsTab'
)
const GuestsTab = lazyWithRetry(() =>
  import('./v2/pages/admin/GuestsTab').then((m) => ({ default: m.GuestsTab })), 'GuestsTab'
)
const AuditTab = lazyWithRetry(() =>
  import('./v2/pages/admin/AuditTab').then((m) => ({ default: m.AuditTab })), 'AuditTab'
)
const PlansTab = lazyWithRetry(() =>
  import('./v2/pages/admin/PlansTab').then((m) => ({ default: m.PlansTab })), 'PlansTab'
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
      <NativeAppBridge />
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
          <Route path="meetings" element={<SearchAwareRedirect to="/v2/app/meetings" />} />
          <Route path="meetings/*" element={<V2MeetingsSubpathRedirect />} />
          <Route path="notetaker" element={<SearchAwareRedirect to="/v2/app/notetaker" />} />
          <Route path="app" element={<V2RequireAuth />}>
            <Route index element={<V2AppHome />} />
            <Route path="calls" element={<V2CallsPage />} />
            <Route path="meetings" element={<V2MeetingsList />} />
            <Route path="meetings/:id" element={<V2MeetingDetail />} />
            <Route path="notetaker" element={<V2NotetakerPage />} />
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
                <Route path="marketing" element={<AdminMarketingPage />} />
                <Route path="guests" element={<GuestsTab />} />
                <Route path="audit" element={<AuditTab />} />
              </Route>
            </Route>
            <Route path="superadmin/*" element={<SuperAdminRedirect />} />
          </Route>
        </Route>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/login" element={<SearchAwareRedirect to="/v2/login" />} />
        <Route path="/signup" element={<SearchAwareRedirect to="/v2/signup" />} />
        <Route path="/reset-password" element={<SearchAwareRedirect to="/v2/reset-password" />} />
        <Route path="/app" element={<SearchAwareRedirect to="/v2/app" />} />
        <Route path="/app/*" element={<AppSubpathRedirect />} />
        <Route path="/blog" element={<BlogStaticRedirect />} />
        <Route path="/blog/*" element={<BlogStaticRedirect />} />
        <Route path="/preview" element={<PreviewStaticRedirect />} />
        <Route path="/preview/*" element={<PreviewStaticRedirect />} />
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
