import { useCallback, useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { MeetingTypeForm } from '../components/MeetingTypeForm'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { createMeetingType, deleteMeetingType, listMeetingTypes, updateMeetingType } from '../services/meetingTypesApi'

export function MeetingTypesPage() {
  const location = useLocation()
  const [meetingTypes, setMeetingTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saveLoading, setSaveLoading] = useState(false)
  const [editing, setEditing] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [error, setError] = useState('')

  const loadMeetingTypes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listMeetingTypes()
      setMeetingTypes(data)
    } catch (loadError) {
      setError(loadError.message ?? 'Impossible de charger les types de meeting.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMeetingTypes()
  }, [loadMeetingTypes, location.key])

  const handleCreateMeetingType = async (values) => {
    setSaveLoading(true)
    try {
      await createMeetingType(values)
      await loadMeetingTypes()
    } finally {
      setSaveLoading(false)
    }
  }

  const handleUpdateMeetingType = async (values) => {
    if (!editing) return

    setSaveLoading(true)
    try {
      await updateMeetingType(editing.id, values)
      setEditing(null)
      await loadMeetingTypes()
    } finally {
      setSaveLoading(false)
    }
  }

  const handleDeleteMeetingType = async () => {
    if (!toDelete) return
    await deleteMeetingType(toDelete.id)
    setToDelete(null)
    await loadMeetingTypes()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Types de meeting</CardTitle>
          <CardDescription>
            Liste globale des meetings utilisables pour tous les clients. Chaque client active uniquement les types
            necessaires.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MeetingTypeForm onSubmit={handleCreateMeetingType} loading={saveLoading} submitLabel="Ajouter" />
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Types existants</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetingTypes.map((meetingType) => (
                  <TableRow key={meetingType.id}>
                    <TableCell className="font-medium">{meetingType.label}</TableCell>
                    <TableCell>{meetingType.code}</TableCell>
                    <TableCell>
                      {meetingType.is_active ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Inactif</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(meetingType)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Modifier
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setToDelete(meetingType)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Supprimer
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => {
          if (!open) setToDelete(null)
        }}
        title="Supprimer ce type de meeting ?"
        description={`Etes-vous sur de vouloir supprimer ${toDelete?.label ?? 'ce type'} ? Les prompts associes seront aussi supprimes.`}
        onConfirm={handleDeleteMeetingType}
      />

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>Edition: {editing.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <MeetingTypeForm
              initialValues={{
                code: editing.code,
                label: editing.label,
                isActive: editing.is_active,
              }}
              onSubmit={handleUpdateMeetingType}
              loading={saveLoading}
              submitLabel="Mettre a jour"
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
