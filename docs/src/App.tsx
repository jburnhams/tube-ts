import { useEffect, useRef, useState } from 'react'
import { TubePlayer } from 'tube-ts'

function App() {
  const [videoId, setVideoId] = useState('dQw4w9WgXcQ')
  const [status, setStatus] = useState('Ready')
  const [isPlaying, setIsPlaying] = useState(false)
  const playerRef = useRef<TubePlayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && !playerRef.current) {
        // Initialize player when component mounts and container is ready
        // We need to give the container an ID or pass the element
        // The TubePlayer expects an ID in the constructor currently, let's fix that or use an ID
        containerRef.current.id = 'tube-player-container';
        try {
            const player = new TubePlayer('tube-player-container');
            player.initialize().then(() => {
                playerRef.current = player;
                setStatus('Player Initialized');
            }).catch(e => {
                setStatus(`Initialization failed: ${e.message}`);
            });
        } catch (e: any) {
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

    setStatus(`Loading ${videoId}...`);
    setIsPlaying(true);
    try {
        await playerRef.current.loadVideo(videoId);
        setStatus('Playing');
    } catch (e: any) {
        setStatus(`Error: ${e.message}`);
        setIsPlaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
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

                <button
                    onClick={handlePlay}
                    disabled={!playerRef.current}
                    className="w-full inline-flex justify-center rounded-md border border-transparent bg-red-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors duration-200 disabled:opacity-50"
                >
                    Load Video
                </button>

                <div className="p-4 bg-gray-100 rounded-md text-left">
                    <p className="text-sm font-mono text-gray-800">
                        Status: {status}
                    </p>
                </div>
            </div>
        </div>
      </div>
    </div>
  )
}

export default App
