# ScreenShare Meeting App

A web-based video conferencing and screen sharing application built with WebRTC and Socket.io.

## Features

- Video conferencing with multiple participants
- Screen sharing
- Chat functionality
- Mobile-optimized responsive design
- Device selection (cameras, microphones, speakers)
- Network quality settings
- Room sharing via link or code
- PWA support for mobile installation

## Technologies Used

- WebRTC for peer-to-peer video/audio streaming
- Socket.io for signaling
- Express.js for the server
- Tailwind CSS for UI styling
- Vanilla JavaScript with ES6 modules

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository:
   ```
   git clone [repository-url]
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm run dev
   ```

4. Access the application at `http://localhost:3000`

### Production Deployment

1. Build the CSS:
   ```
   npm run build:css
   ```

2. Start the production server:
   ```
   npm start
   ```

## Usage

### Hosting a Meeting

1. Click the "Host Meeting" button
2. Allow camera and microphone permissions when prompted
3. Share the generated room code or link with others

### Joining a Meeting

1. Click the "Join Meeting" button
2. Enter the room code you received
3. Allow camera and microphone permissions when prompted

### Controls

- Toggle camera on/off
- Toggle microphone on/off
- Share your screen
- View participants list
- Open chat panel
- Change audio/video devices
- Adjust network settings
- Leave meeting

## Development

The application uses a modular architecture:

- `public/js/main.js` - Main entry point
- `public/js/services/` - Core functionality services (socket, media)
- `public/js/ui/` - UI components and interactions
- `public/js/webrtc/` - WebRTC peer connection handling
- `public/js/utils/` - Utility functions
- `server.js` - Server-side code for signaling and room management

## Browser Support

The application works best in:
- Chrome (desktop and Android)
- Firefox (desktop and Android)
- Safari (desktop and iOS)
- Edge (desktop)

## Known Limitations

- Screen sharing may not work on all mobile browsers
- Safari has limited WebRTC support for certain features
- Performance may vary based on network conditions and number of participants

## License

This project is licensed under the MIT License.

## Acknowledgments

- WebRTC standards and documentation
- Socket.io project
- Tailwind CSS for styling

## Auto-Deployment Test

This line was added to test the auto-deployment system on July 6, 2025.
✅ Auto-deployment system is working perfectly! 