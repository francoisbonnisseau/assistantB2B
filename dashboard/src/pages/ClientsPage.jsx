import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { createClient, deleteClient, listClients } from '../services/clientsApi'
import { ClientForm } from '../components/ClientForm'
import { ClientList } from '../components/ClientList'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'

export function ClientsPage() {
  const location = useLocation()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [openCreate, setOpenCreate] = useState(false)
  const [error, setError] = useState('')
  const [clientToDelete, setClientToDelete] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const loadClients = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listClients()
      setClients(data)
    } catch (loadError) {
      setError(loadError.message ?? 'Impossible de charger les clients.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadClients()
  }, [loadClients, location.key])

  const handleCreateClient = async (values) => {
    await createClient(values)
    setOpenCreate(false)
    await loadClients()
  }

  const handleDeleteClient = async () => {
    if (!clientToDelete) return

    setDeleteLoading(true)
    try {
      await deleteClient(clientToDelete.id)
      setClientToDelete(null)
      await loadClients()
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none bg-[linear-gradient(130deg,_rgba(10,131,134,0.18),_rgba(255,241,217,0.8))]">
        <CardHeader>
          <CardTitle>Comptes clients</CardTitle>
          <CardDescription>
            Cree et gere les acces clients. La liste affiche uniquement les usernames.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nouveau client
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Creer un compte client</DialogTitle>
              </DialogHeader>
              <ClientForm onSubmit={handleCreateClient} />
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <Card>
          <CardContent className="py-10">
            <p className="text-center text-muted-foreground">Chargement...</p>
          </CardContent>
        </Card>
      ) : (
        <ClientList clients={clients} onDelete={setClientToDelete} />
      )}

      <DeleteConfirmDialog
        open={Boolean(clientToDelete)}
        onOpenChange={(open) => {
          if (!open) setClientToDelete(null)
        }}
        title="Supprimer ce client ?"
        description={`Etes-vous sur de vouloir supprimer ${clientToDelete?.username ?? 'ce client'} ? Cette action est irreversible.`}
        onConfirm={handleDeleteClient}
        loading={deleteLoading}
      />
    </div>
  )
}
