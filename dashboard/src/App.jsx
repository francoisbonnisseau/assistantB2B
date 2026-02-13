import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Building2, LogOut, NotebookText, Users } from 'lucide-react'
import { Toaster } from 'sonner'
import { LoginPage } from './pages/LoginPage'
import { ClientsPage } from './pages/ClientsPage'
import { ClientDetailPage } from './pages/ClientDetailPage'
import { MeetingTypesPage } from './pages/MeetingTypesPage'
import { supabase } from './services/supabaseClient'
import { isUserAdmin } from './services/adminApi'
import { Button } from './components/ui/button'
import { cn } from './lib/utils'

function App() {
  const [session, setSession] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const location = useLocation()

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession()

      if (!mounted) return
      setSession(currentSession)

      if (currentSession?.user) {
        const adminStatus = await isUserAdmin(currentSession.user.id)
        if (mounted) setIsAdmin(adminStatus)
      }

      if (mounted) setLoading(false)
    }

    bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_, nextSession) => {
      setSession(nextSession)

      if (!nextSession?.user) {
        setIsAdmin(false)
        return
      }

      const adminStatus = await isUserAdmin(nextSession.user.id)
      setIsAdmin(adminStatus)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const hasAccess = useMemo(() => Boolean(session?.user && isAdmin), [session, isAdmin])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Chargement du dashboard...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f5ede4_0%,_#f7f4ef_35%,_#fbfaf8_100%)] text-foreground">
      {hasAccess ? <AdminHeader pathname={location.pathname} /> : null}
      <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <Routes>
          <Route path="/login" element={hasAccess ? <Navigate to="/clients" replace /> : <LoginPage />} />
          <Route path="/clients" element={<ProtectedPage hasAccess={hasAccess}><ClientsPage /></ProtectedPage>} />
          <Route
            path="/clients/:clientId"
            element={<ProtectedPage hasAccess={hasAccess}><ClientDetailPage /></ProtectedPage>}
          />
          <Route
            path="/meeting-types"
            element={<ProtectedPage hasAccess={hasAccess}><MeetingTypesPage /></ProtectedPage>}
          />
          <Route path="*" element={<Navigate to={hasAccess ? '/clients' : '/login'} replace />} />
        </Routes>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  )
}

function ProtectedPage({ hasAccess, children }) {
  if (!hasAccess) {
    return <Navigate to="/login" replace />
  }

  return children
}

function AdminHeader({ pathname }) {
  const items = [
    { label: 'Clients', href: '/clients', icon: Users },
    { label: 'Types de meeting', href: '/meeting-types', icon: NotebookText },
  ]

  const logout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <header className="border-b border-border/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">Admin Dashboard</p>
            <p className="text-xs text-muted-foreground">Gestion des comptes clients et prompts</p>
          </div>
        </div>
        <nav className="flex items-center gap-2">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
          <Button type="button" variant="outline" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Se deconnecter
          </Button>
        </nav>
      </div>
    </header>
  )
}

export default App
