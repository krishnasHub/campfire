import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Debug aids: surface runtime errors and (optionally) every stream event to the console.
window.__cfDebug = localStorage.getItem('cf-debug') === '1'
console.log('%c🔥 campfire', 'color:#f59e0b;font-weight:bold',
  '— to log every stream event: localStorage.setItem("cf-debug","1") then reload')
window.addEventListener('error', e => console.error('[campfire] window error:', e.message, e.error))
window.addEventListener('unhandledrejection', e => console.error('[campfire] unhandled rejection:', e.reason))

createRoot(document.getElementById('root')).render(<App />)
