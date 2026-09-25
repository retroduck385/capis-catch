import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RouterProvider } from 'react-router-dom'
import { router } from './router.jsx'
import { AuthContextProvider } from './context/authContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <>
    <h1> Change me in Main.jsx im Universal </h1>
    <AuthContextProvider>
      <RouterProvider router={router} />
    </AuthContextProvider>

    </>
  </StrictMode>,
)
