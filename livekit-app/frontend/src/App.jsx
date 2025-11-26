import { Routes, Route, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect } from 'react'
import HomeScreen from './components/HomeScreen'
import MeetingRoom from './components/MeetingRoom'
import JoinMeeting from './components/JoinMeeting'
import ErrorBoundary from './components/ErrorBoundary'

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
