import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { useTable, useInsert, useUpdate, useDelete } from '@/hooks/useSupabaseQuery'
import type { Client } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Plus, Upload, Search, Pencil, Trash2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClientForm = {
  name: string
  contact_name: string
  phone: string
  email: string
  status: string
}

const emptyForm: ClientForm = {
  name: '',
  contact_name: '',
  phone: '',
  email: '',
  status: 'פעיל',
}

type ImportRow = {
  name: string
  contact_name: string
  phone: string
  email: string
  status: string
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'פעיל' || status === 'active') return 'default'
  if (status === 'לא פעיל' || status === 'inactive') return 'secondary'
  return 'outline'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Clients() {
  const { data: clients = [], isLoading } = useTable<Client>('clients')
  const insert = useInsert<Client>('clients')
  const update = useUpdate<Client>('clients')
  const remove = useDelete('clients')

  // Search
  const [search, setSearch] = useState('')

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [form, setForm] = useState<ClientForm>(emptyForm)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null)

  // Import dialog
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [importFileName, setImportFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------------------
  // Filtered clients
  // -------------------------------------------------------------------------

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  // -------------------------------------------------------------------------
  // Add / Edit handlers
  // -------------------------------------------------------------------------

  function openAddDialog() {
    setEditingClient(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEditDialog(client: Client) {
    setEditingClient(client)
    setForm({
      name: client.name,
      contact_name: client.contact_name,
      phone: client.phone,
      email: client.email,
      status: client.status,
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setForm(emptyForm)
    setEditingClient(null)
  }

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')

  async function handleSave() {
    if (!form.name.trim()) return
    setSaveStatus('saving')
    try {
      if (editingClient) {
        await update.mutateAsync({ id: editingClient.id, ...form })
      } else {
        await insert.mutateAsync(form)
      }
      setSaveStatus('success')
      setTimeout(() => {
        setSaveStatus('idle')
        closeDialog()
      }, 2000)
    } catch (err) {
      console.error('Save error:', err)
      setSaveStatus('error')
    }
  }

  // -------------------------------------------------------------------------
  // Delete handlers
  // -------------------------------------------------------------------------

  function openDeleteDialog(client: Client) {
    setDeleteTarget(client)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await remove.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  // -------------------------------------------------------------------------
  // Import helpers
  // -------------------------------------------------------------------------

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const json: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      const rows: ImportRow[] = json.map((row) => ({
        name: String(row['name'] ?? row['שם'] ?? ''),
        contact_name: String(row['contact_name'] ?? row['איש קשר'] ?? ''),
        phone: String(row['phone'] ?? row['טלפון'] ?? ''),
        email: String(row['email'] ?? row['אימייל'] ?? ''),
        status: String(row['status'] ?? row['סטטוס'] ?? 'פעיל'),
      }))

      setImportRows(rows.filter((r) => r.name.trim() !== ''))
      setImportFileName(file.name)
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  async function handleConfirmImport() {
    for (const row of importRows) {
      await insert.mutateAsync(row)
    }
    setImportOpen(false)
    setImportRows([])
    setImportFileName('')
  }

  function closeImportDialog() {
    setImportOpen(false)
    setImportRows([])
    setImportFileName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div dir="rtl" className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">לקוחות</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            ייבוא
          </Button>
          <Button
            onClick={openAddDialog}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Plus className="h-4 w-4" />
            הוסף לקוח
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="חיפוש לפי שם..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9"
        />
      </div>

      {/* Table */}
      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם</TableHead>
                <TableHead className="text-right">איש קשר</TableHead>
                <TableHead className="text-right">טלפון</TableHead>
                <TableHead className="text-right">אימייל</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    לא נמצאו לקוחות
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>{client.contact_name}</TableCell>
                    <TableCell>{client.phone}</TableCell>
                    <TableCell>{client.email}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(client.status)}>{client.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditDialog(client)}
                          title="עריכה"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openDeleteDialog(client)}
                          title="מחיקה"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingClient ? 'עריכת לקוח' : 'הוספת לקוח'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="client-name">שם</Label>
              <Input
                id="client-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="שם הלקוח"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-name">איש קשר</Label>
              <Input
                id="contact-name"
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                placeholder="שם איש הקשר"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-phone">טלפון</Label>
              <Input
                id="client-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="050-0000000"
                dir="ltr"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-email">אימייל</Label>
              <Input
                id="client-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="example@company.com"
                dir="ltr"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-status">סטטוס</Label>
              <Input
                id="client-status"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                placeholder="פעיל / לא פעיל"
              />
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2">
            {saveStatus === 'success' && (
              <p className="text-green-600 font-medium text-sm text-right">המידע נשמר ✓</p>
            )}
            {saveStatus === 'error' && (
              <p className="text-red-600 font-medium text-sm text-right">שגיאה בשמירה, נסה שנית</p>
            )}
            <div className="flex gap-2 flex-row-reverse">
              <Button
                onClick={handleSave}
                disabled={saveStatus === 'saving' || saveStatus === 'success' || !form.name.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {saveStatus === 'saving' ? 'שומר...' : 'שמור'}
              </Button>
              <Button variant="outline" onClick={closeDialog} disabled={saveStatus === 'saving'}>
                ביטול
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>מחיקת לקוח</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם אתה בטוח שברצונך למחוק את הלקוח{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
            פעולה זו אינה ניתנת לביטול.
          </p>
          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'מוחק...' : 'מחק'}
            </Button>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) closeImportDialog() }}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>ייבוא לקוחות מקובץ</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/20'
                  : 'border-muted-foreground/30 hover:border-purple-400 hover:bg-muted/40'
              }`}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              {importFileName ? (
                <p className="text-sm font-medium">{importFileName}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">גרור קובץ לכאן או לחץ לבחירה</p>
                  <p className="text-xs text-muted-foreground mt-1">קבצי Excel (.xlsx, .xls) או CSV</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {/* Column mapping note */}
            {importRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                עמודות נדרשות: <span className="font-mono">name / שם</span>,{' '}
                <span className="font-mono">contact_name / איש קשר</span>,{' '}
                <span className="font-mono">phone / טלפון</span>,{' '}
                <span className="font-mono">email / אימייל</span>,{' '}
                <span className="font-mono">status / סטטוס</span>
              </p>
            )}

            {/* Preview table */}
            {importRows.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">שם</TableHead>
                      <TableHead className="text-right">איש קשר</TableHead>
                      <TableHead className="text-right">טלפון</TableHead>
                      <TableHead className="text-right">אימייל</TableHead>
                      <TableHead className="text-right">סטטוס</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importRows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{row.contact_name}</TableCell>
                        <TableCell>{row.phone}</TableCell>
                        <TableCell>{row.email}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(row.status)}>{row.status || 'פעיל'}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {importRows.length > 0 && (
              <p className="text-sm text-muted-foreground">
                נמצאו <span className="font-semibold text-foreground">{importRows.length}</span> רשומות לייבוא
              </p>
            )}
          </div>

          <DialogFooter className="flex gap-2 flex-row-reverse">
            <Button
              onClick={handleConfirmImport}
              disabled={importRows.length === 0 || insert.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {insert.isPending ? 'מייבא...' : `אשר ייבוא (${importRows.length})`}
            </Button>
            <Button variant="outline" onClick={closeImportDialog}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
