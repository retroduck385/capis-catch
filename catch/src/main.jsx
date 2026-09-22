import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <>
    <h1> Hello Test </h1>
    <RouterProvider router={router} />

    </>
  </StrictMode>,
)
