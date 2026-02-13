import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ClientEdit } from '../components/ClientEdit'
import { ClientPromptsTable } from '../components/ClientPromptsTable'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { createClientPrompt, deleteClientPrompt, listClientPrompts, updateClientPrompt } from '../services/clientPromptsApi'
import { getClientById, deleteClient, updateClient } from '../services/clientsApi'
import { listMeetingTypes } from '../services/meetingTypesApi'

export function ClientDetailPage() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState(null)
  const [meetingTypes, setMeetingTypes] = useState([])
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saveLoading, setSaveLoading] = useState(false)
  const [deletePromptLoading, setDeletePromptLoading] = useState(false)
  const [deleteClientOpen, setDeleteClientOpen] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [clientData, meetingTypesData, promptsData] = await Promise.all([
        getClientById(clientId),
        listMeetingTypes(),
        listClientPrompts(clientId),
      ])
      setClient(clientData)
      setMeetingTypes(meetingTypesData.filter((meetingType) => meetingType.is_active))
      setPrompts(promptsData)
    } catch (loadError) {
      setError(loadError.message ?? 'Impossible de charger ce client.')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleUpdateClient = async (values) => {
    setSaveLoading(true)
    try {
      const updated = await updateClient(clientId, values)
      setClient(updated)
    } finally {
      setSaveLoading(false)
    }
  }

  const handleAddPrompt = async ({ meetingTypeId, prompt }) => {
    await createClientPrompt({ clientId, meetingTypeId, prompt })
    const updatedPrompts = await listClientPrompts(clientId)
    setPrompts(updatedPrompts)
  }

  const handleUpdatePrompt = async (promptId, promptValue) => {
    await updateClientPrompt(promptId, promptValue)
    const updatedPrompts = await listClientPrompts(clientId)
    setPrompts(updatedPrompts)
  }

  const handleDeletePrompt = async (promptId) => {
    setDeletePromptLoading(true)
    try {
      await deleteClientPrompt(promptId)
      const updatedPrompts = await listClientPrompts(clientId)
      setPrompts(updatedPrompts)
    } finally {
      setDeletePromptLoading(false)
    }
  }

  const handleDeleteClient = async () => {
    await deleteClient(clientId)
    navigate('/clients')
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">Chargement...</CardContent>
      </Card>
    )
  }

  if (!client) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">Client introuvable.</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link to="/clients">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour aux clients
          </Link>
        </Button>
        <Button variant="destructive" onClick={() => setDeleteClientOpen(true)}>
          Supprimer ce client
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ClientEdit client={client} onSubmit={handleUpdateClient} loading={saveLoading} />

      <ClientPromptsTable
        meetingTypes={meetingTypes}
        prompts={prompts}
        onAddPrompt={handleAddPrompt}
        onUpdatePrompt={handleUpdatePrompt}
        onDeletePrompt={handleDeletePrompt}
        loading={deletePromptLoading}
      />

      <DeleteConfirmDialog
        open={deleteClientOpen}
        onOpenChange={setDeleteClientOpen}
        title="Supprimer ce client ?"
        description="Etes-vous sur de vouloir supprimer ce client ? Les prompts associes seront aussi supprimes."
        onConfirm={handleDeleteClient}
      />
    </div>
  )
}
