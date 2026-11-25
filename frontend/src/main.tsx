import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { applyTheme } from '@/design-system'
import { router } from './router'

// paint the saved theme before the first render, so there is no flash of the default
applyTheme()

const queryClient = new QueryClient()

// index.html always has it; the app has nothing to render into if it doesn't.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
