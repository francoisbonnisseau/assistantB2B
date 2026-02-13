import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import { validateClientPassword, validateUsername } from '../utils/validators'

const defaultValues = {
  username: '',
  password: '',
  isActive: true,
  metadata: {
    company: '',
    name: '',
    description: '',
  },
}

export function ClientForm({ mode = 'create', initialValues, onSubmit, submitLabel, loading = false }) {
  const mergedInitialValues = useMemo(() => {
    if (!initialValues) return defaultValues
    return {
      ...defaultValues,
      ...initialValues,
      metadata: {
        ...defaultValues.metadata,
        ...(initialValues.metadata ?? {}),
      },
      password: '',
    }
  }, [initialValues])

  const [values, setValues] = useState(mergedInitialValues)
  const [error, setError] = useState('')

  const isEdit = mode === 'edit'

  const handleChange = (field, value) => {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  const handleMetadataChange = (field, value) => {
    setValues((prev) => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        [field]: value,
      },
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    const usernameError = validateUsername(values.username)
    if (usernameError) {
      setError(usernameError)
      return
    }

    const passwordError = validateClientPassword(values.password, { required: !isEdit })
    if (passwordError) {
      setError(passwordError)
      return
    }

    try {
      await onSubmit(values)
      if (!isEdit) {
        setValues(defaultValues)
      }
    } catch (submitError) {
      setError(submitError.message ?? 'Impossible de sauvegarder ce client.')
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          value={values.username}
          onChange={(event) => handleChange('username', event.target.value)}
          placeholder="ex: client.marin"
          autoComplete="off"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Mot de passe client</Label>
        <Input
          id="password"
          type="password"
          value={values.password}
          onChange={(event) => handleChange('password', event.target.value)}
          placeholder={isEdit ? 'Laisser vide pour conserver le mot de passe actuel' : ''}
          required={!isEdit}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            value={values.metadata.company}
            onChange={(event) => handleMetadataChange('company', event.target.value)}
            placeholder="Entreprise"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="name">Nom du contact</Label>
          <Input
            id="name"
            value={values.metadata.name}
            onChange={(event) => handleMetadataChange('name', event.target.value)}
            placeholder="Nom"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description generale</Label>
        <Textarea
          id="description"
          value={values.metadata.description}
          onChange={(event) => handleMetadataChange('description', event.target.value)}
          placeholder="Infos generales partagees a tous les types de meeting"
        />
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={values.isActive}
          onChange={(event) => handleChange('isActive', event.target.checked)}
        />
        Compte actif
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? 'Enregistrement...' : submitLabel ?? (isEdit ? 'Mettre a jour' : 'Creer le client')}
        </Button>
      </div>
    </form>
  )
}
