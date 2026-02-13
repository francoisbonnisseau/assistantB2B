import { useMemo, useState } from 'react'
import { Pencil, Save, Trash2, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Textarea } from './ui/textarea'

export function ClientPromptsTable({ meetingTypes, prompts, onAddPrompt, onUpdatePrompt, onDeletePrompt, loading }) {
  const [selectedMeetingType, setSelectedMeetingType] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [editingPromptId, setEditingPromptId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [error, setError] = useState('')

  const assignedMeetingTypeIds = useMemo(
    () => new Set(prompts.map((prompt) => prompt.meeting_type_id)),
    [prompts],
  )

  const availableMeetingTypes = useMemo(
    () => meetingTypes.filter((meetingType) => !assignedMeetingTypeIds.has(meetingType.id)),
    [meetingTypes, assignedMeetingTypeIds],
  )

  const submitNewPrompt = async (event) => {
    event.preventDefault()
    setError('')

    if (!selectedMeetingType) {
      setError('Selectionne un type de meeting.')
      return
    }

    if (!newPrompt.trim()) {
      setError('Le prompt est obligatoire.')
      return
    }

    try {
      await onAddPrompt({ meetingTypeId: selectedMeetingType, prompt: newPrompt })
      setSelectedMeetingType('')
      setNewPrompt('')
    } catch (submitError) {
      setError(submitError.message ?? 'Impossible d\'ajouter ce prompt.')
    }
  }

  const startEdit = (prompt) => {
    setEditingPromptId(prompt.id)
    setEditingValue(prompt.prompt)
  }

  const saveEdit = async () => {
    if (!editingValue.trim()) {
      setError('Le prompt ne peut pas etre vide.')
      return
    }

    setError('')
    await onUpdatePrompt(editingPromptId, editingValue)
    setEditingPromptId(null)
    setEditingValue('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompts par type de meeting</CardTitle>
        <CardDescription>
          Ajoute uniquement les types utiles pour ce client, puis associe un prompt a chacun.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="space-y-3 rounded-md border border-border bg-secondary/40 p-4" onSubmit={submitNewPrompt}>
          <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="meetingType">Type de meeting</Label>
              <select
                id="meetingType"
                className="h-10 rounded-md border border-input bg-card px-3 text-sm"
                value={selectedMeetingType}
                onChange={(event) => setSelectedMeetingType(event.target.value)}
              >
                <option value="">Selectionner</option>
                {availableMeetingTypes.map((meetingType) => (
                  <option key={meetingType.id} value={meetingType.id}>
                    {meetingType.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newPrompt">Prompt</Label>
              <Textarea
                id="newPrompt"
                value={newPrompt}
                onChange={(event) => setNewPrompt(event.target.value)}
                placeholder="Instructions specifiques pour ce type de meeting"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !availableMeetingTypes.length}>
              <Plus className="mr-2 h-4 w-4" />
              Ajouter ce prompt
            </Button>
          </div>
        </form>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Type de meeting</TableHead>
              <TableHead>Prompt</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prompts.length ? (
              prompts.map((prompt) => (
                <TableRow key={prompt.id}>
                  <TableCell className="font-medium">{prompt.meeting_types?.label ?? '-'}</TableCell>
                  <TableCell>
                    {editingPromptId === prompt.id ? (
                      <Textarea
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        className="min-h-24"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm">{prompt.prompt}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {editingPromptId === prompt.id ? (
                        <Button size="sm" onClick={saveEdit}>
                          <Save className="mr-2 h-4 w-4" />
                          Sauvegarder
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => startEdit(prompt)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Modifier
                        </Button>
                      )}
                      <Button variant="destructive" size="sm" onClick={() => onDeletePrompt(prompt.id)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Supprimer
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  Aucun prompt configure pour ce client.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
