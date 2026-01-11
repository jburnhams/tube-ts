import { useEffect, useRef, useState } from 'react'
import { TubePlayer } from '@jburnhams/tube-ts'

function App() {
  const [videoId, setVideoId] = useState('dQw4w9WgXcQ')
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('tube-ts-session-id') || '')
  const [status, setStatus] = useState('Ready')
  const [intervalSeconds, setIntervalSeconds] = useState(10)
  const [intervalCount, setIntervalCount] = useState(0)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const playerRef = useRef<TubePlayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('tube-ts-session-id', sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (containerRef.current && !playerRef.current) {
        // Initialize player when component mounts and container is ready
        containerRef.current.id = 'tube-player-container';
        try {
            const player = new TubePlayer('tube-player-container');

            // Register interval listener
            player.onPlayInterval(intervalSeconds, () => {
                setIntervalCount(prev => prev + 1);
                setIsModalOpen(true);
            });

            player.initialize().then(() => {
                playerRef.current = player;
                setStatus('Player Initialized');
            }).catch(e => {
                console.error(e);
                setStatus(`Initialization failed: ${e.message}`);
            });
        } catch (e: any) {
            console.error(e);
            setStatus(`Error creating player: ${e.message}`);
        }
    }

    return () => {
        if (playerRef.current) {
            playerRef.current.destroy();
            playerRef.current = null;
        }
    }
  }, []);

  const handlePlay = async () => {
    if (!playerRef.current) return;

    // Update interval before loading/playing (in case user changed it)
    playerRef.current.onPlayInterval(intervalSeconds, () => {
        setIntervalCount(prev => prev + 1);
        setIsModalOpen(true);
    });

    setStatus(`Loading ${videoId}...`);
    try {
        await playerRef.current.loadVideo(videoId);
        setStatus('Playing');
    } catch (e: any) {
        console.error(e);
        setStatus(`Error: ${e.message}`);
    }
  }

  const handleResume = () => {
      setIsModalOpen(false);
      playerRef.current?.play();
  }

  const handleStop = () => {
      setIsModalOpen(false);
      // Video is already paused
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 relative">
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full">
                <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Playback Paused</h3>
                <p className="text-sm text-gray-500 mb-4">
                    Interval listener called {intervalCount} times.
                </p>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={handleStop}
                        className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:text-sm"
                    >
                        Stop
                    </button>
                    <button
                        onClick={handleResume}
                        className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:text-sm"
                    >
                        Resume
                    </button>
                </div>
            </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">TubeTS Player</h1>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-2/3 aspect-video bg-black rounded-lg overflow-hidden relative" ref={containerRef}>
                {/* Video will be injected here */}
            </div>

            <div className="w-full md:w-1/3 space-y-6">
                <div>
                    <label htmlFor="videoId" className="block text-sm font-medium text-gray-700 text-left mb-1">
                        Video ID
                    </label>
                    <input
                        id="videoId"
                        type="text"
                        value={videoId}
                        onChange={(e) => setVideoId(e.target.value)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                        placeholder="Enter Video ID"
                    />
                </div>

                <div>
                    <label htmlFor="sessionId" className="block text-sm font-medium text-gray-700 text-left mb-1">
                        Session ID
                    </label>
                    <input
                        id="sessionId"
                        type="text"
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                        placeholder="Enter Session ID"
                    />
                </div>

                <div>
                    <label htmlFor="interval" className="block text-sm font-medium text-gray-700 text-left mb-1">
                        Pause Interval (seconds)
                    </label>
                    <input
                        id="interval"
                        type="number"
                        min="1"
                        value={intervalSeconds}
                        onChange={(e) => setIntervalSeconds(parseInt(e.target.value) || 10)}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                    />
                </div>

                <button
                    onClick={handlePlay}
                    disabled={!playerRef.current}
                    className="w-full inline-flex justify-center rounded-md border border-transparent bg-red-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors duration-200 disabled:opacity-50"
                >
                    Load Video
                </button>

                <div className="p-4 bg-gray-100 rounded-md text-left">
                    <p className="text-sm font-mono text-gray-800">
                        Status: <span id="status-text">{status}</span>
                    </p>
                </div>
            </div>
        </div>
      </div>
    </div>
  )
}

export default App
