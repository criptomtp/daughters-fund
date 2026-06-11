import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.jsx'
import { ErrorBoundary } from './portfolio/ErrorBoundary.jsx'
import { SupportCheck } from './portfolio/SupportCheck.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <SupportCheck>
        <App />
      </SupportCheck>
    </ErrorBoundary>
  </StrictMode>,
)
