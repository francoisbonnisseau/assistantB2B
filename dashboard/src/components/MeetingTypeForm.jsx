import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { validateMeetingType } from '../utils/validators'

const defaultValues = {
  code: '',
  label: '',
  isActive: true,
}

export function MeetingTypeForm({ initialValues, onSubmit, loading, submitLabel = 'Enregistrer' }) {
  const mergedInitialValues = useMemo(
    () => ({
      ...defaultValues,
      ...(initialValues ?? {}),
    }),
    [initialValues],
  )

  const [values, setValues] = useState(mergedInitialValues)
  const [error, setError] = useState('')

  const handleChange = (field, value) => setValues((prev) => ({ ...prev, [field]: value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    const validationError = validateMeetingType(values)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      await onSubmit(values)
      if (!initialValues) setValues(defaultValues)
    } catch (submitError) {
      setError(submitError.message ?? 'Impossible de sauvegarder ce type de meeting.')
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            value={values.label}
            onChange={(event) => handleChange('label', event.target.value)}
            placeholder="Ex: Meeting de vente"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            value={values.code}
            onChange={(event) => handleChange('code', event.target.value.toLowerCase())}
            placeholder="meeting_vente"
          />
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={values.isActive}
          onChange={(event) => handleChange('isActive', event.target.checked)}
        />
        Type actif
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? 'Enregistrement...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
