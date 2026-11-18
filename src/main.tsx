import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'

function Placeholder() {
  return <p>Sordulo OS</p>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
)
