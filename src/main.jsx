import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.jsx'
import { ErrorBoundary } from './portfolio/ErrorBoundary.jsx'
import { SupportCheck } from './portfolio/SupportCheck.jsx'
import { SeedImport } from './portfolio/SeedImport.jsx'

// Позначка для сторожа в index.html: бандл виконався, лікувати нема чого.
window.__appBooted = true

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <SupportCheck>
        <SeedImport />
        <App />
      </SupportCheck>
    </ErrorBoundary>
  </StrictMode>,
)
