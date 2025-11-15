import { useDaily, useLocalParticipant } from '@daily-co/daily-react';

const Controls = ({ onLeave, onToggleChat, onToggleParticipants, showChat, showParticipants }) => {
  const daily = useDaily();
  const localParticipant = useLocalParticipant();

  const micEnabled = localParticipant?.audio;
  const webcamEnabled = localParticipant?.video;
  const screenShareEnabled = localParticipant?.screenVideo;

  const toggleMic = () => {
    if (daily) {
      daily.setLocalAudio(!micEnabled);
    }
  };

  const toggleWebcam = () => {
    if (daily) {
      daily.setLocalVideo(!webcamEnabled);
    }
  };

  const toggleScreenShare = async () => {
    if (!daily) return;
    
    try {
      if (screenShareEnabled) {
        console.log('Stopping screen share...');
        await daily.stopScreenShare();
        console.log('Screen share stopped');
      } else {
        console.log('Starting screen share...');
        await daily.startScreenShare({
          audio: true, // Include system audio
          width: 1920,
          height: 1080
        });
        console.log('Screen share started');
      }
    } catch (error) {
      console.error('Screen share error:', error);
      alert(`Screen share failed: ${error.message || 'Please check browser permissions'}`);
    }
  };

  const handleLeave = () => {
    if (daily) {
      daily.leave();
    }
    if (onLeave) {
      onLeave();
    }
  };

  const ControlButton = ({ onClick, icon, label, active = false, danger = false }) => {
    const baseClasses = "flex flex-col items-center justify-center p-3 rounded-lg transition-all min-w-[60px] min-h-[60px] md:min-w-[80px] md:min-h-[80px]";
    const activeClasses = active 
      ? "bg-blue-600 text-white" 
      : "bg-gray-700 text-white hover:bg-gray-600";
    const dangerClasses = danger ? "bg-red-600 hover:bg-red-700" : "";

    return (
      <button
        onClick={onClick}
        className={`${baseClasses} ${dangerClasses || activeClasses}`}
        aria-label={label}
      >
        {icon}
        <span className="text-xs mt-1 hidden md:block">{label}</span>
      </button>
    );
  };

  return (
    <div className="bg-gray-800 px-4 py-3 flex items-center justify-center gap-2 md:gap-4">
      {/* Mic Toggle */}
      <ControlButton
        onClick={toggleMic}
        active={micEnabled}
        label="Mic"
        icon={
          micEnabled ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
            </svg>
          )
        }
      />

      {/* Camera Toggle */}
      <ControlButton
        onClick={toggleWebcam}
        active={webcamEnabled}
        label="Camera"
        icon={
          webcamEnabled ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
            </svg>
          )
        }
      />

      {/* Screen Share */}
      <ControlButton
        onClick={toggleScreenShare}
        active={screenShareEnabled}
        label="Share"
        icon={
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
          </svg>
        }
      />

      {/* Participants */}
      <ControlButton
        onClick={onToggleParticipants}
        active={showParticipants}
        label="People"
        icon={
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
          </svg>
        }
      />

      {/* Chat */}
      <ControlButton
        onClick={onToggleChat}
        active={showChat}
        label="Chat"
        icon={
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
        }
      />

      {/* Leave */}
      <ControlButton
        onClick={handleLeave}
        danger={true}
        label="Leave"
        icon={
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        }
      />
    </div>
  );
};

export default Controls;
