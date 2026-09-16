import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import App from './App.tsx'
import { SiteSeo } from './seo/SiteSeo'
import { ConfirmProvider } from './components/confirm/ConfirmProvider'
import { createAppQueryClient } from './lib/queryClient'
import { PanelThemeProvider } from './theme/PanelThemeProvider'
import { ThemeProvider } from './theme/ThemeContext'
import { installUppercaseTyping } from './utils/uppercaseTyping'
import './index.css'

const queryClient = createAppQueryClient()

/** Lo que se escribe en mayúscula (ver `index.css`) también se guarda en mayúscula. */
installUppercaseTyping()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <SiteSeo />
          <ConfirmProvider>
            <AuthProvider>
              <PanelThemeProvider>
                <App />
              </PanelThemeProvider>
            </AuthProvider>
          </ConfirmProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
