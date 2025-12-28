import { useState } from 'react'
import { hello, goodbye } from 'my-library'

function App() {
  const [name, setName] = useState('World')
  const [greeting, setGreeting] = useState('')

  const handleGreet = () => {
    setGreeting(hello(name))
  }

  const handleGoodbye = () => {
    setGreeting(goodbye(name))
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden md:max-w-2xl p-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">My Library Docs</h1>

          <div className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 text-left mb-1">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                placeholder="Enter a name"
              />
            </div>

            <div className="flex justify-center space-x-4">
              <button
                onClick={handleGreet}
                className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors duration-200"
              >
                Greet
              </button>
              <button
                onClick={handleGoodbye}
                className="inline-flex justify-center rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors duration-200"
              >
                Say Goodbye
              </button>
            </div>

            {greeting && (
              <div className="mt-6 p-4 bg-indigo-50 rounded-md">
                <p className="text-lg text-indigo-900 font-medium" data-testid="greeting-result">
                  {greeting}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
