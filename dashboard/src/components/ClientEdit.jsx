import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { ClientForm } from './ClientForm'

export function ClientEdit({ client, onSubmit, loading }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Modifier le client</CardTitle>
        <CardDescription>Met a jour le compte et les informations generales de ce client.</CardDescription>
      </CardHeader>
      <CardContent>
        <ClientForm mode="edit" initialValues={client} onSubmit={onSubmit} loading={loading} />
      </CardContent>
    </Card>
  )
}
