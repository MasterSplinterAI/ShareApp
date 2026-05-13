import { Routes, Route, useLocation } from 'react-router-dom'
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
import V2SuperAdmin from './v2/pages/V2SuperAdmin'

function App() {
  const location = useLocation();
  
  useEffect(() => {
    // Route tracking removed for cleaner console
  }, [location]);
  
  return (
    <>
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
      <Routes>
        <Route path="/v2" element={<V2Layout />}>
          <Route index element={<V2RootRedirect />} />
          <Route path="login" element={<V2Login />} />
          <Route path="signup" element={<V2Signup />} />
          <Route path="app" element={<V2RequireAuth />}>
            <Route index element={<V2AppHome />} />
            <Route path="meetings" element={<V2MeetingsList />} />
            <Route path="meetings/:id" element={<V2MeetingDetail />} />
            <Route path="settings" element={<V2OrgSettings />} />
            <Route path="superadmin" element={<V2SuperAdmin />} />
          </Route>
        </Route>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/room/:roomName" element={
          <ErrorBoundary>
            <MeetingRoom />
          </ErrorBoundary>
        } />
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
    </>
  )
}

export default App
