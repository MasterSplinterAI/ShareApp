import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect } from 'react'
import HomeScreen from './components/HomeScreen'
import MeetingRoom from './components/MeetingRoom'
import JoinMeeting from './components/JoinMeeting'
import ErrorBoundary from './components/ErrorBoundary'
import V2Layout from './v2/V2Layout'
import V2RequireAuth from './v2/V2RequireAuth'
import V2Login from './v2/pages/V2Login'
import V2Signup from './v2/pages/V2Signup'
import V2AppHome from './v2/pages/V2AppHome'
import V2MeetingsList from './v2/pages/V2MeetingsList'
import V2MeetingDetail from './v2/pages/V2MeetingDetail'
import V2Schedule from './v2/pages/V2Schedule'
import V2HostPanel from './v2/pages/V2HostPanel'
import V2FilesPage from './v2/pages/V2FilesPage'
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
            background: '#1f2937',
            color: '#f3f4f6',
          },
        }}
      />
      <Routes>
        <Route path="/v2" element={<V2Layout />}>
          <Route index element={<Navigate to="login" replace />} />
          <Route path="login" element={<V2Login />} />
          <Route path="signup" element={<V2Signup />} />
          <Route path="app" element={<V2RequireAuth />}>
            <Route index element={<V2AppHome />} />
            <Route path="meetings" element={<V2MeetingsList />} />
            <Route path="meetings/:id" element={<V2MeetingDetail />} />
            <Route path="schedule" element={<V2Schedule />} />
            <Route path="host" element={<V2HostPanel />} />
            <Route path="files" element={<V2FilesPage />} />
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
          <div className="min-h-screen bg-gray-900 flex items-center justify-center">
            <div className="text-white">
              <h1>404 - Page not found</h1>
              <p>Current path: {location.pathname}</p>
            </div>
          </div>
        } />
      </Routes>
    </>
  )
}

export default App
