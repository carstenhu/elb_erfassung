import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import clsx from 'clsx'
import { availableRequiredFields } from './app/defaults'
import {
  downloadElbPdf,
  downloadObjectsPdf,
  downloadWordDocx,
  downloadWordPdf,
  exportAllArtifacts,
} from './app/exports'
import { useAppStore } from './app/store'
import {
  buildPdfPreviewPages as buildPdfPreviewPagesFromMap,
  buildWordPreviewPages as buildWordPreviewPagesFromMap,
} from './app/templateMaps'
import type {
  Auction,
  CaseRecord,
  Clerk,
  DepartmentInterest,
  MasterData,
  ObjectItem,
  PreviewPage,
} from './app/types'

type SectionEditorTarget =
  | { type: 'consignor' }
  | { type: 'owner' }
  | { type: 'bank' }
  | { type: 'costs' }
  | { type: 'internal' }
  | { type: 'object'; objectId: string }
  | { type: 'signature' }

type MissingFieldEntry = {
  label: string
  path: string
  blocked?: boolean
}

const routeItems = [
  { to: '/', label: 'Einlieferer' },
  { to: '/objekte', label: 'Objekte' },
  { to: '/interne-infos', label: 'Interne Infos' },
  { to: '/pdf-vorschau', label: 'ELB-PDF Vorschau' },
  { to: '/word-vorschau', label: 'Word Schätzliste Vorschau' },
]

const fieldLabelMap = new Map(availableRequiredFields.map((entry) => [entry.key, entry.label]))

const getByPath = (record: CaseRecord, path: string): unknown => {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1')
  return normalized.split('.').reduce<unknown>((cursor, key) => {
    if (cursor === undefined || cursor === null) {
      return undefined
    }
    if (Array.isArray(cursor)) {
      return cursor[Number(key)]
    }
    return (cursor as Record<string, unknown>)[key]
  }, record as unknown)
}

const formatObjectLabel = (item: ObjectItem, index: number) =>
  item.shortDesc ? `${index + 1}. ${item.shortDesc}` : `Objekt ${index + 1}`

const resolveMissingFields = (record: CaseRecord, requiredKeys: string[]) => {
  const missing: MissingFieldEntry[] = []

  requiredKeys.forEach((key) => {
    if (key.includes('[]')) {
      if (record.objects.length === 0) {
        missing.push({ label: fieldLabelMap.get(key) ?? key, path: key, blocked: true })
        return
      }
      record.objects.forEach((item, index) => {
        const concretePath = key.replace('[]', `[${index}]`)
        const value = getByPath(record, concretePath)
        if (value === undefined || value === '' || value === null) {
          missing.push({
            label: `${fieldLabelMap.get(key) ?? key} (${formatObjectLabel(item, index)})`,
            path: concretePath,
          })
        }
      })
      return
    }
    const value = getByPath(record, key)
    if (value === undefined || value === '' || value === null) {
      missing.push({ label: fieldLabelMap.get(key) ?? key, path: key })
    }
  })

  return missing
}

const getAuctionLabel = (masterData: MasterData, auctionId: string) => {
  const auction = masterData.auctions.find((entry) => entry.id === auctionId)
  return auction ? `${auction.number} / ${auction.month} ${auction.year}` : ''
}

const buildPdfPreviewPages = (record: CaseRecord): PreviewPage[] =>
  buildPdfPreviewPagesFromMap(record)

const buildWordPreviewPages = (record: CaseRecord, masterData: MasterData): PreviewPage[] =>
  buildWordPreviewPagesFromMap(record, masterData)

const editTargetFromKey = (editKey?: string): SectionEditorTarget | null => {
  if (!editKey) {
    return null
  }
  if (editKey.startsWith('object:')) {
    return { type: 'object', objectId: editKey.replace('object:', '') }
  }
  if (editKey === 'consignor' || editKey === 'owner' || editKey === 'bank' || editKey === 'costs' || editKey === 'internal' || editKey === 'signature') {
    return { type: editKey }
  }
  return null
}

const readFilesAsDataUrls = async (files: FileList | File[]) => {
  const entries = Array.from(files)
  return Promise.all(
    entries.map(
      (file) =>
        new Promise<{ id: string; name: string; dataUrl: string }>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, dataUrl: String(reader.result) })
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        }),
    ),
  )
}

const useActiveCase = () => {
  const data = useAppStore((state) => state.data)
  return useMemo(() => data.cases.find((record) => record.id === data.activeCaseId) ?? null, [data.activeCaseId, data.cases])
}

const TextField = ({ label, value, onChange, textarea, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; textarea?: boolean; type?: string }) => (
  <label className="field">
    <span>{label}</span>
    {textarea ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />}
  </label>
)

const CheckboxField = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) => (
  <label className="checkbox-field">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>
)

const SelectField = ({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) => (
  <label className="field">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Bitte waehlen</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
)

const MultiSelectField = ({ label, values, onChange, options }: { label: string; values: string[]; onChange: (values: string[]) => void; options: { value: string; label: string }[] }) => (
  <div className="field">
    <span>{label}</span>
    <div className="tag-grid">
      {options.map((option) => {
        const selected = values.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            className={clsx('tag-button', selected && 'selected')}
            onClick={() => onChange(selected ? values.filter((entry) => entry !== option.value) : [...values, option.value])}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  </div>
)

const SectionCard = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
  <section className="card">
    <div className="card-header">
      <div>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
    </div>
    <div className="field-grid">{children}</div>
  </section>
)
const CaseSidebar = ({ activeCase }: { activeCase: CaseRecord | null }) => {
  const data = useAppStore((state) => state.data)
  const createCase = useAppStore((state) => state.createCase)
  const setActiveCase = useAppStore((state) => state.setActiveCase)
  const selectedCases = data.cases.filter((record) => record.clerkId === data.selectedClerkId)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <p className="eyebrow">Vorgaenge</p>
          <h2>{data.masterData.clerks.find((clerk) => clerk.id === data.selectedClerkId)?.name ?? 'Kein Sachbearbeiter'}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={createCase}>Neuer Vorgang</button>
      </div>
      <div className="case-list">
        {selectedCases.map((record) => (
          <button key={record.id} type="button" className={clsx('case-item', activeCase?.id === record.id && 'active')} onClick={() => setActiveCase(record.id)}>
            <strong>{record.meta.receiptNo || 'Unbenannt'}</strong>
            <span>{record.consignor.lastName || 'Einlieferer offen'}</span>
            <small>Revision {record.revision}</small>
          </button>
        ))}
      </div>
    </aside>
  )
}

const StartOverlay = () => {
  const data = useAppStore((state) => state.data)
  const selectClerk = useAppStore((state) => state.selectClerk)

  if (data.selectedClerkId) {
    return null
  }

  return (
    <div className="overlay">
      <div className="overlay-card">
        <p className="eyebrow">Startauswahl</p>
        <h2>Sachbearbeiter waehlen</h2>
        <p>Alle Payload-Daten und ELB-Nummern werden pro Sachbearbeiter gespeichert.</p>
        <div className="selection-grid">
          {data.masterData.clerks.map((clerk) => (
            <button key={clerk.id} type="button" className="selection-card" onClick={() => selectClerk(clerk.id)}>
              <strong>{clerk.name}</strong>
              <span>{clerk.email}</span>
              <small>{clerk.phone}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const EinliefererPage = ({ record, masterData }: { record: CaseRecord; masterData: MasterData }) => {
  const updateField = useAppStore((state) => state.updateField)

  return (
    <div className="page-stack">
      <SectionCard title="Meta" description="ELB-Nummer, Datum und globale Vorgangsdaten">
        <TextField label="ELB-Nummer" value={record.meta.receiptNo} onChange={(value) => updateField('meta.receiptNo', value)} />
        <TextField label="Datum" type="date" value={record.meta.date} onChange={(value) => updateField('meta.date', value)} />
        <TextField label="Kundennummer" value={record.consignor.customerNo} onChange={(value) => updateField('consignor.customerNo', value)} />
        <SelectField label="Anrede" value={record.consignor.title} onChange={(value) => updateField('consignor.title', value)} options={masterData.titles.map((title) => ({ value: title, label: title }))} />
      </SectionCard>

      <SectionCard title="Einlieferer" description="Adress- und Personendaten">
        <CheckboxField label="Firmenadresse statt Privatadresse" checked={record.consignor.captureCompanyAddress} onChange={(value) => updateField('consignor.captureCompanyAddress', value)} />
        <TextField label="Firma" value={record.consignor.company} onChange={(value) => updateField('consignor.company', value)} />
        <TextField label="Vorname" value={record.consignor.firstName} onChange={(value) => updateField('consignor.firstName', value)} />
        <TextField label="Nachname" value={record.consignor.lastName} onChange={(value) => updateField('consignor.lastName', value)} />
        <TextField label="Adresszusatz" value={record.consignor.addressAddon1} onChange={(value) => updateField('consignor.addressAddon1', value)} />
        <TextField label="Strasse" value={record.consignor.street} onChange={(value) => updateField('consignor.street', value)} />
        <TextField label="Hausnummer" value={record.consignor.houseNo} onChange={(value) => updateField('consignor.houseNo', value)} />
        <TextField label="PLZ" value={record.consignor.zip} onChange={(value) => updateField('consignor.zip', value)} />
        <TextField label="Stadt" value={record.consignor.city} onChange={(value) => updateField('consignor.city', value)} />
        <TextField label="Land" value={record.consignor.country} onChange={(value) => updateField('consignor.country', value)} />
        <TextField label="E-Mail" value={record.consignor.email} onChange={(value) => updateField('consignor.email', value)} />
        <TextField label="Telefon" value={record.consignor.phone} onChange={(value) => updateField('consignor.phone', value)} />
        <TextField label="Geburtsdatum" value={record.consignor.birthdate} onChange={(value) => updateField('consignor.birthdate', value)} />
        <TextField label="Nationalitaet" value={record.consignor.nationality} onChange={(value) => updateField('consignor.nationality', value)} />
        <TextField label="ID-/Passnummer" value={record.consignor.passportNo} onChange={(value) => updateField('consignor.passportNo', value)} />
      </SectionCard>

      <SectionCard title="Eigentuemer" description="Eigentuemerdaten liegen auf derselben Seite">
        <CheckboxField label="Eigentuemer entspricht Einlieferer" checked={record.owner.sameAsConsignor} onChange={(value) => updateField('owner.sameAsConsignor', value)} />
        <TextField label="Vorname" value={record.owner.firstName} onChange={(value) => updateField('owner.firstName', value)} />
        <TextField label="Nachname" value={record.owner.lastName} onChange={(value) => updateField('owner.lastName', value)} />
        <TextField label="Strasse" value={record.owner.street} onChange={(value) => updateField('owner.street', value)} />
        <TextField label="Hausnummer" value={record.owner.houseNo} onChange={(value) => updateField('owner.houseNo', value)} />
        <TextField label="PLZ" value={record.owner.zip} onChange={(value) => updateField('owner.zip', value)} />
        <TextField label="Stadt" value={record.owner.city} onChange={(value) => updateField('owner.city', value)} />
        <TextField label="Land" value={record.owner.country} onChange={(value) => updateField('owner.country', value)} />
      </SectionCard>

      <SectionCard title="Bank" description="Bankdaten des gesamten Vorgangs">
        <TextField label="Beguenstigter" value={record.bank.beneficiary} onChange={(value) => updateField('bank.beneficiary', value)} />
        <TextField label="IBAN" value={record.bank.iban} onChange={(value) => updateField('bank.iban', value)} />
        <TextField label="BIC" value={record.bank.bic} onChange={(value) => updateField('bank.bic', value)} />
        <TextField label="Abweichender Beguenstigter" value={record.bank.diffBeneficiary} onChange={(value) => updateField('bank.diffBeneficiary', value)} />
        <TextField label="Name abweichender Beguenstigter" value={record.bank.diffBeneficiaryName} onChange={(value) => updateField('bank.diffBeneficiaryName', value)} />
        <TextField label="Grund" value={record.bank.diffReason} onChange={(value) => updateField('bank.diffReason', value)} textarea />
      </SectionCard>
    </div>
  )
}

const ObjectEditor = ({ record, masterData, inModal = false, selectedObjectId }: { record: CaseRecord; masterData: MasterData; inModal?: boolean; selectedObjectId?: string }) => {
  const addObject = useAppStore((state) => state.addObject)
  const removeObject = useAppStore((state) => state.removeObject)
  const replaceObjectPhotos = useAppStore((state) => state.replaceObjectPhotos)
  const removePhoto = useAppStore((state) => state.removePhoto)
  const updateField = useAppStore((state) => state.updateField)
  const objects = selectedObjectId ? record.objects.filter((item) => item.id === selectedObjectId) : record.objects

  return (
    <div className={clsx('page-stack', inModal && 'compact-stack')}>
      {!selectedObjectId ? (
        <SectionCard title="Konditionen" description="Diese Konditionen gelten fuer alle Objekte des Vorgangs">
          <TextField label="Kommission" value={record.costs.kommission} onChange={(value) => updateField('costs.kommission', value)} />
          <TextField label="Versicherung" value={record.costs.versicherung} onChange={(value) => updateField('costs.versicherung', value)} />
          <TextField label="Transport" value={record.costs.transport} onChange={(value) => updateField('costs.transport', value)} />
          <TextField label="Abb.-Kosten" value={record.costs.abbKosten} onChange={(value) => updateField('costs.abbKosten', value)} />
          <TextField label="Kosten Expertisen" value={record.costs.kostenExpertisen} onChange={(value) => updateField('costs.kostenExpertisen', value)} />
          <TextField label="Internet" value={record.costs.internet} onChange={(value) => updateField('costs.internet', value)} />
          <CheckboxField label="Alle Kosten nur bei Erfolg" checked={record.costs.onlyIfSuccess} onChange={(value) => updateField('costs.onlyIfSuccess', value)} />
          <TextField label="Provenienz / Diverses" value={record.costs.provenance} onChange={(value) => updateField('costs.provenance', value)} textarea />
        </SectionCard>
      ) : null}

      {!selectedObjectId ? (
        <div className="toolbar">
          <div>
            <p className="eyebrow">Objektverwaltung</p>
            <h3>{record.objects.length} Objekte im Vorgang</h3>
          </div>
          <button type="button" className="primary-button" onClick={addObject}>Objekt hinzufuegen</button>
        </div>
      ) : null}
      {objects.map((item) => {
        const objectIndex = record.objects.findIndex((entry) => entry.id === item.id)
        return (
          <section key={item.id} className="card">
            <div className="card-header split">
              <div>
                <h3>{formatObjectLabel(item, objectIndex)}</h3>
                <p>{getAuctionLabel(masterData, item.auctionId) || 'Auktion noch nicht gewaehlt'}</p>
              </div>
              {!selectedObjectId ? <button type="button" className="ghost-button" onClick={() => removeObject(item.id)}>Entfernen</button> : null}
            </div>
            <div className="field-grid">
              <TextField label="Int.-Nr." value={item.intNo} onChange={(value) => updateField(`objects[${objectIndex}].intNo`, value)} />
              <SelectField label="Auktion" value={item.auctionId} onChange={(value) => updateField(`objects[${objectIndex}].auctionId`, value)} options={masterData.auctions.map((auction) => ({ value: auction.id, label: `${auction.number} / ${auction.month} ${auction.year}` }))} />
              <SelectField label="Abteilung" value={item.departmentId} onChange={(value) => updateField(`objects[${objectIndex}].departmentId`, value)} options={masterData.departments.map((department) => ({ value: department.id, label: `${department.code} - ${department.name}` }))} />
              <TextField label="Kurzbeschreibung" value={item.shortDesc} onChange={(value) => updateField(`objects[${objectIndex}].shortDesc`, value)} />
              <TextField label="Beschreibung" value={item.desc} onChange={(value) => updateField(`objects[${objectIndex}].desc`, value)} textarea />
              <TextField label="Schaetzung von" value={item.estimateLow} onChange={(value) => updateField(`objects[${objectIndex}].estimateLow`, value)} />
              <TextField label="Schaetzung bis" value={item.estimateHigh} onChange={(value) => updateField(`objects[${objectIndex}].estimateHigh`, value)} />
              <TextField label="Limite" value={item.limit} onChange={(value) => updateField(`objects[${objectIndex}].limit`, value)} />
              <TextField label="Abb.-Kosten" value={item.abbCost} onChange={(value) => updateField(`objects[${objectIndex}].abbCost`, value)} />
              <TextField label="Referenznr." value={item.received} onChange={(value) => updateField(`objects[${objectIndex}].received`, value)} />
              <TextField label="Bemerkungen" value={item.remarks} onChange={(value) => updateField(`objects[${objectIndex}].remarks`, value)} textarea />
              <CheckboxField label="Nettolimite" checked={item.netLimit} onChange={(value) => updateField(`objects[${objectIndex}].netLimit`, value)} />
              <div className="field photo-field">
                <span>Fotos</span>
                <label className="file-button">
                  Fotos hinzufuegen
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    multiple
                    onChange={async (event) => {
                      const files = event.target.files
                      if (!files?.length) {
                        return
                      }
                      const nextPhotos = await readFilesAsDataUrls(files)
                      replaceObjectPhotos(item.id, [...item.photos, ...nextPhotos].slice(0, 10))
                      event.target.value = ''
                    }}
                  />
                </label>
                <div className="photo-grid">
                  {item.photos.map((photo) => (
                    <div key={photo.id} className="photo-thumb">
                      <img src={photo.dataUrl} alt={photo.name} />
                      <small>{photo.name}</small>
                      <button type="button" className="ghost-button" onClick={() => removePhoto(item.id, photo.id)}>Entfernen</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

const InterneInfosPage = ({ record, masterData }: { record: CaseRecord; masterData: MasterData }) => {
  const updateField = useAppStore((state) => state.updateField)

  return (
    <div className="page-stack">
      <SectionCard title="Interessengebiete" description="Mehrfachauswahl aus der zentralen Stammdatenliste">
        <MultiSelectField label="Interessengebiete" values={record.internalInfo.interestIds} onChange={(values) => updateField('internalInfo.interestIds', values)} options={masterData.departments.map((department) => ({ value: department.id, label: `${department.code} - ${department.name}` }))} />
      </SectionCard>
      <SectionCard title="Interne Notizen">
        <TextField label="Notiz" value={record.internalInfo.note} onChange={(value) => updateField('internalInfo.note', value)} textarea />
      </SectionCard>
    </div>
  )
}

const PreviewSurface = ({
  pages,
  accent,
  onFieldClick,
}: {
  pages: PreviewPage[]
  accent: 'pdf' | 'word'
  onFieldClick?: (editKey?: string) => void
}) => (
  <div className="preview-pages">
    {pages.map((page) => (
      <article key={page.id} className={clsx('preview-page', accent)}>
        <header>
          <p className="eyebrow">{page.title}</p>
          <h3>{page.subtitle}</h3>
        </header>
        <div className="document-surface">
          {page.fields.map((field) => (
            <button
              key={field.id}
              type="button"
              className="preview-field"
              onClick={() => onFieldClick?.(field.editKey)}
              style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.w * 100}%`, height: `${field.h * 100}%` }}
            >
              <small>{field.label}</small>
              <strong>{field.value || 'Leer'}</strong>
            </button>
          ))}
        </div>
      </article>
    ))}
  </div>
)

const PreviewQuickEditor = ({ record, onEdit }: { record: CaseRecord; onEdit: (target: SectionEditorTarget) => void }) => (
  <div className="quick-editor">
    <section className="card">
      <div className="card-header"><div><p className="eyebrow">Direkt aus der Vorschau</p><h3>Felder bearbeiten</h3></div></div>
      <div className="action-list">
        <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'consignor' })}>Einlieferer bearbeiten</button>
        <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'owner' })}>Eigentuemer bearbeiten</button>
        <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'bank' })}>Bank bearbeiten</button>
        <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'costs' })}>Konditionen bearbeiten</button>
        <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'internal' })}>Interne Infos bearbeiten</button>
        <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'signature' })}>Signatur bearbeiten</button>
      </div>
    </section>
    <section className="card">
      <div className="card-header"><div><p className="eyebrow">Objekte</p><h3>{record.objects.length} Vorschau-Eintraege</h3></div></div>
      <div className="action-list">
        {record.objects.map((item, index) => (
          <button key={item.id} type="button" className="secondary-button" onClick={() => onEdit({ type: 'object', objectId: item.id })}>{formatObjectLabel(item, index)}</button>
        ))}
      </div>
    </section>
  </div>
)

const SignaturePad = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return
    }
    context.fillStyle = '#f8f3e7'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = '#0f172a'
    context.lineWidth = 2
    context.lineJoin = 'round'
    context.lineCap = 'round'
    if (value) {
      const image = new Image()
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height)
      image.src = value
    }
  }, [value])

  const updateFromCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    onChange(canvas.toDataURL('image/png'))
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={520}
        height={160}
        onPointerDown={(event) => {
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d')
          if (!canvas || !context) {
            return
          }
          const rect = canvas.getBoundingClientRect()
          context.beginPath()
          context.moveTo(event.clientX - rect.left, event.clientY - rect.top)
          setDrawing(true)
        }}
        onPointerMove={(event) => {
          if (!drawing) {
            return
          }
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d')
          if (!canvas || !context) {
            return
          }
          const rect = canvas.getBoundingClientRect()
          context.lineTo(event.clientX - rect.left, event.clientY - rect.top)
          context.stroke()
        }}
        onPointerUp={() => {
          setDrawing(false)
          updateFromCanvas()
        }}
        onPointerLeave={() => {
          if (drawing) {
            setDrawing(false)
            updateFromCanvas()
          }
        }}
      />
      <div className="inline-actions"><button type="button" className="secondary-button" onClick={() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) {
          return
        }
        context.fillStyle = '#f8f3e7'
        context.fillRect(0, 0, canvas.width, canvas.height)
        onChange('')
      }}>Leeren</button></div>
    </div>
  )
}
const SectionEditorModal = ({ target, record, masterData, onClose }: { target: SectionEditorTarget; record: CaseRecord; masterData: MasterData; onClose: () => void }) => {
  const updateField = useAppStore((state) => state.updateField)

  return (
    <div className="overlay">
      <div className="overlay-card wide">
        <div className="modal-header">
          <div><p className="eyebrow">Vorschau-Modal</p><h2>Felder bearbeiten</h2></div>
          <button type="button" className="ghost-button" onClick={onClose}>Schliessen</button>
        </div>

        {target.type === 'consignor' ? (
          <div className="field-grid">
            <TextField label="Vorname" value={record.consignor.firstName} onChange={(value) => updateField('consignor.firstName', value)} />
            <TextField label="Nachname" value={record.consignor.lastName} onChange={(value) => updateField('consignor.lastName', value)} />
            <TextField label="Firma" value={record.consignor.company} onChange={(value) => updateField('consignor.company', value)} />
            <TextField label="Strasse" value={record.consignor.street} onChange={(value) => updateField('consignor.street', value)} />
            <TextField label="Hausnummer" value={record.consignor.houseNo} onChange={(value) => updateField('consignor.houseNo', value)} />
            <TextField label="PLZ" value={record.consignor.zip} onChange={(value) => updateField('consignor.zip', value)} />
            <TextField label="Stadt" value={record.consignor.city} onChange={(value) => updateField('consignor.city', value)} />
            <TextField label="E-Mail" value={record.consignor.email} onChange={(value) => updateField('consignor.email', value)} />
            <TextField label="Telefon" value={record.consignor.phone} onChange={(value) => updateField('consignor.phone', value)} />
          </div>
        ) : null}

        {target.type === 'owner' ? (
          <div className="field-grid">
            <CheckboxField label="Eigentuemer entspricht Einlieferer" checked={record.owner.sameAsConsignor} onChange={(value) => updateField('owner.sameAsConsignor', value)} />
            <TextField label="Vorname" value={record.owner.firstName} onChange={(value) => updateField('owner.firstName', value)} />
            <TextField label="Nachname" value={record.owner.lastName} onChange={(value) => updateField('owner.lastName', value)} />
            <TextField label="Strasse" value={record.owner.street} onChange={(value) => updateField('owner.street', value)} />
            <TextField label="PLZ" value={record.owner.zip} onChange={(value) => updateField('owner.zip', value)} />
            <TextField label="Stadt" value={record.owner.city} onChange={(value) => updateField('owner.city', value)} />
          </div>
        ) : null}

        {target.type === 'bank' ? (
          <div className="field-grid">
            <TextField label="Beguenstigter" value={record.bank.beneficiary} onChange={(value) => updateField('bank.beneficiary', value)} />
            <TextField label="IBAN" value={record.bank.iban} onChange={(value) => updateField('bank.iban', value)} />
            <TextField label="BIC" value={record.bank.bic} onChange={(value) => updateField('bank.bic', value)} />
            <TextField label="Grund" value={record.bank.diffReason} onChange={(value) => updateField('bank.diffReason', value)} textarea />
          </div>
        ) : null}

        {target.type === 'costs' ? <ObjectEditor record={record} masterData={masterData} inModal /> : null}

        {target.type === 'internal' ? (
          <div className="field-grid">
            <MultiSelectField label="Interessengebiete" values={record.internalInfo.interestIds} onChange={(values) => updateField('internalInfo.interestIds', values)} options={masterData.departments.map((department) => ({ value: department.id, label: `${department.code} - ${department.name}` }))} />
            <TextField label="Interne Notiz" value={record.internalInfo.note} onChange={(value) => updateField('internalInfo.note', value)} textarea />
          </div>
        ) : null}

        {target.type === 'object' ? <ObjectEditor record={record} masterData={masterData} inModal selectedObjectId={target.objectId} /> : null}
        {target.type === 'signature' ? <div className="field-grid single-column"><p>Canvas-Unterschrift fuer das finale ELB-PDF.</p><SignaturePad value={record.signatures.consignorPng} onChange={(value) => updateField('signatures.consignorPng', value)} /></div> : null}
      </div>
    </div>
  )
}

const MissingFieldModal = ({ record, missing, onClose, onContinue }: { record: CaseRecord; missing: MissingFieldEntry[]; onClose: () => void; onContinue: () => void }) => {
  const updateField = useAppStore((state) => state.updateField)
  const actionable = missing.filter((entry) => !entry.blocked)
  const blocked = missing.filter((entry) => entry.blocked)

  return (
    <div className="overlay">
      <div className="overlay-card wide">
        <div className="modal-header">
          <div><p className="eyebrow">Pflichtfelder fehlen</p><h2>Bitte vor dem PDF-Export ergaenzen</h2></div>
          <button type="button" className="ghost-button" onClick={onClose}>Schliessen</button>
        </div>
        <div className="field-grid">
          {actionable.map((entry) => (
            <TextField key={entry.path} label={entry.label} value={String(getByPath(record, entry.path) ?? '')} onChange={(value) => updateField(entry.path, value)} />
          ))}
        </div>
        {blocked.length ? <div className="notice-list">{blocked.map((entry) => <p key={entry.path}>{entry.label}: Mindestens ein Objekt mit diesen Pflichtfeldern ist erforderlich.</p>)}</div> : null}
        <div className="inline-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Spaeter</button>
          <button type="button" className="primary-button" onClick={onContinue}>Erneut pruefen und exportieren</button>
        </div>
      </div>
    </div>
  )
}

const PdfPreviewPage = ({ record, masterData, onEdit }: { record: CaseRecord; masterData: MasterData; onEdit: (target: SectionEditorTarget) => void }) => {
  const data = useAppStore((state) => state.data)
  const [missingFields, setMissingFields] = useState<MissingFieldEntry[] | null>(null)
  const pages = useMemo(() => buildPdfPreviewPages(record), [record])
  const wordPreviewPages = useMemo(() => buildWordPreviewPages(record, masterData), [record, masterData])

  const handleExport = async () => {
    const missing = resolveMissingFields(record, data.pdfRequiredFields)
    if (missing.length) {
      setMissingFields(missing)
      return
    }
    await downloadElbPdf(record, masterData)
  }

  return (
    <>
      <div className="preview-layout">
        <PreviewSurface
          pages={pages}
          accent="pdf"
          onFieldClick={(editKey) => {
            const target = editTargetFromKey(editKey)
            if (target) {
              onEdit(target)
            }
          }}
        />
        <div className="preview-sidebar">
          <PreviewQuickEditor record={record} onEdit={onEdit} />
          <section className="card">
            <div className="card-header"><div><p className="eyebrow">Signatur</p><h3>Unterschrift vor finalem Export</h3></div></div>
            <SignaturePad value={record.signatures.consignorPng} onChange={(value) => useAppStore.getState().updateField('signatures.consignorPng', value)} />
          </section>
          <section className="card">
            <div className="action-list">
              <button type="button" className="primary-button" onClick={() => void handleExport()}>Definitives ELB-PDF exportieren</button>
              <button type="button" className="secondary-button" onClick={() => void downloadObjectsPdf(record, masterData)}>Zusatz-PDF mit Objekten</button>
              <button type="button" className="secondary-button" onClick={() => void exportAllArtifacts(record, masterData, wordPreviewPages)}>Finales ZIP erzeugen</button>
            </div>
          </section>
        </div>
      </div>

      {missingFields ? (
        <MissingFieldModal
          record={record}
          missing={missingFields}
          onClose={() => setMissingFields(null)}
          onContinue={() => {
            const latest = useAppStore.getState().data.cases.find((entry) => entry.id === record.id) ?? record
            const nextMissing = resolveMissingFields(latest, data.pdfRequiredFields)
            if (nextMissing.length) {
              setMissingFields(nextMissing)
              return
            }
            setMissingFields(null)
            void downloadElbPdf(latest, masterData)
          }}
        />
      ) : null}
    </>
  )
}

const WordPreviewPage = ({ record, masterData, onEdit }: { record: CaseRecord; masterData: MasterData; onEdit: (target: SectionEditorTarget) => void }) => {
  const pages = useMemo(() => buildWordPreviewPages(record, masterData), [record, masterData])

  return (
    <div className="preview-layout">
      <PreviewSurface
        pages={pages}
        accent="word"
        onFieldClick={(editKey) => {
          const target = editTargetFromKey(editKey)
          if (target) {
            onEdit(target)
          }
        }}
      />
      <div className="preview-sidebar">
        <PreviewQuickEditor record={record} onEdit={onEdit} />
        <section className="card">
          <div className="action-list">
            <button type="button" className="primary-button" onClick={() => void downloadWordDocx(record, masterData)}>Definitive DOCX-Datei</button>
            <button type="button" className="secondary-button" onClick={() => void downloadWordPdf(pages, record.meta.receiptNo)}>PDF aus Word-Vorschau</button>
          </div>
        </section>
      </div>
    </div>
  )
}
const AdminPanel = () => {
  const data = useAppStore((state) => state.data)
  const adminOpen = useAppStore((state) => state.adminOpen)
  const activeSection = useAppStore((state) => state.activeAdminSection)
  const setAdminOpen = useAppStore((state) => state.setAdminOpen)
  const setActiveAdminSection = useAppStore((state) => state.setActiveAdminSection)
  const upsertClerk = useAppStore((state) => state.upsertClerk)
  const removeClerk = useAppStore((state) => state.removeClerk)
  const upsertAuction = useAppStore((state) => state.upsertAuction)
  const removeAuction = useAppStore((state) => state.removeAuction)
  const upsertDepartment = useAppStore((state) => state.upsertDepartment)
  const removeDepartment = useAppStore((state) => state.removeDepartment)
  const setRequiredFields = useAppStore((state) => state.setRequiredFields)

  const [draftClerk, setDraftClerk] = useState<Clerk>({ id: '', name: '', email: '', phone: '' })
  const [draftAuction, setDraftAuction] = useState<Auction>({ id: '', number: '', month: '', year: '' })
  const [draftDepartment, setDraftDepartment] = useState<DepartmentInterest>({ id: '', code: '', name: '' })

  if (!adminOpen) {
    return null
  }

  return (
    <div className="overlay">
      <div className="overlay-card admin">
        <div className="modal-header">
          <div><p className="eyebrow">Admin Panel</p><h2>Zentrale Stammdaten und PDF-Pflichtfelder</h2></div>
          <button type="button" className="ghost-button" onClick={() => setAdminOpen(false)}>Schliessen</button>
        </div>

        <div className="admin-layout">
          <div className="admin-nav">
            {[
              ['clerks', 'Sachbearbeiter'],
              ['auctions', 'Auktionen'],
              ['departments', 'Abteilungen / Interessen'],
              ['required-fields', 'PDF-Pflichtfelder'],
            ].map(([value, label]) => (
              <button key={value} type="button" className={clsx('secondary-button', activeSection === value && 'active')} onClick={() => setActiveAdminSection(value as never)}>{label}</button>
            ))}
          </div>

          <div className="admin-content">
            {activeSection === 'clerks' ? (
              <section className="card">
                <div className="field-grid">
                  <TextField label="Name" value={draftClerk.name} onChange={(value) => setDraftClerk((current) => ({ ...current, name: value }))} />
                  <TextField label="E-Mail" value={draftClerk.email} onChange={(value) => setDraftClerk((current) => ({ ...current, email: value }))} />
                  <TextField label="Telefon" value={draftClerk.phone} onChange={(value) => setDraftClerk((current) => ({ ...current, phone: value }))} />
                </div>
                <div className="inline-actions">
                  <button type="button" className="primary-button" onClick={() => {
                    if (!draftClerk.name.trim()) return
                    upsertClerk({ ...draftClerk, id: draftClerk.id || `clerk-${draftClerk.name.toLowerCase().replace(/\s+/g, '-')}` })
                    setDraftClerk({ id: '', name: '', email: '', phone: '' })
                  }}>Sachbearbeiter speichern</button>
                </div>
                <div className="admin-list">
                  {data.masterData.clerks.map((clerk) => (
                    <div key={clerk.id} className="list-row">
                      <div><strong>{clerk.name}</strong><span>{clerk.email}</span></div>
                      <div className="inline-actions">
                        <button type="button" className="secondary-button" onClick={() => setDraftClerk(clerk)}>Bearbeiten</button>
                        <button type="button" className="ghost-button" onClick={() => removeClerk(clerk.id)}>Loeschen</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === 'auctions' ? (
              <section className="card">
                <div className="field-grid">
                  <TextField label="Auktionsnummer" value={draftAuction.number} onChange={(value) => setDraftAuction((current) => ({ ...current, number: value }))} />
                  <TextField label="Monat" value={draftAuction.month} onChange={(value) => setDraftAuction((current) => ({ ...current, month: value }))} />
                  <TextField label="Jahr" value={draftAuction.year} onChange={(value) => setDraftAuction((current) => ({ ...current, year: value }))} />
                </div>
                <div className="inline-actions">
                  <button type="button" className="primary-button" onClick={() => {
                    if (!draftAuction.number.trim()) return
                    upsertAuction({ ...draftAuction, id: draftAuction.id || `auction-${draftAuction.number}-${draftAuction.month}-${draftAuction.year}` })
                    setDraftAuction({ id: '', number: '', month: '', year: '' })
                  }}>Auktion speichern</button>
                </div>
                <div className="admin-list">
                  {data.masterData.auctions.map((auction) => (
                    <div key={auction.id} className="list-row">
                      <div><strong>{auction.number}</strong><span>{auction.month} {auction.year}</span></div>
                      <div className="inline-actions">
                        <button type="button" className="secondary-button" onClick={() => setDraftAuction(auction)}>Bearbeiten</button>
                        <button type="button" className="ghost-button" onClick={() => removeAuction(auction.id)}>Loeschen</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === 'departments' ? (
              <section className="card">
                <div className="field-grid">
                  <TextField label="Code" value={draftDepartment.code} onChange={(value) => setDraftDepartment((current) => ({ ...current, code: value }))} />
                  <TextField label="Bezeichnung" value={draftDepartment.name} onChange={(value) => setDraftDepartment((current) => ({ ...current, name: value }))} />
                </div>
                <div className="inline-actions">
                  <button type="button" className="primary-button" onClick={() => {
                    if (!draftDepartment.code.trim() || !draftDepartment.name.trim()) return
                    upsertDepartment({ ...draftDepartment, id: draftDepartment.id || `department-${draftDepartment.code.toLowerCase()}` })
                    setDraftDepartment({ id: '', code: '', name: '' })
                  }}>Eintrag speichern</button>
                </div>
                <div className="admin-list">
                  {data.masterData.departments.map((department) => (
                    <div key={department.id} className="list-row">
                      <div><strong>{department.code}</strong><span>{department.name}</span></div>
                      <div className="inline-actions">
                        <button type="button" className="secondary-button" onClick={() => setDraftDepartment(department)}>Bearbeiten</button>
                        <button type="button" className="ghost-button" onClick={() => removeDepartment(department.id)}>Loeschen</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {activeSection === 'required-fields' ? (
              <section className="card">
                <div className="tag-grid">
                  {availableRequiredFields.map((entry) => {
                    const selected = data.pdfRequiredFields.includes(entry.key)
                    return (
                      <button key={entry.key} type="button" className={clsx('tag-button', selected && 'selected')} onClick={() => setRequiredFields(selected ? data.pdfRequiredFields.filter((value) => value !== entry.key) : [...data.pdfRequiredFields, entry.key])}>
                        {entry.label}
                      </button>
                    )
                  })}
                </div>
                <p className="muted">Diese Pflichtfelder gelten global nur fuer den PDF-Export. Fuer die Word-Schaetzliste gibt es bewusst keine Pflichtfelder.</p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const initialize = useAppStore((state) => state.initialize)
  const setAdminOpen = useAppStore((state) => state.setAdminOpen)
  const isHydrated = useAppStore((state) => state.isHydrated)
  const data = useAppStore((state) => state.data)
  const activeCase = useActiveCase()
  const [sectionEditor, setSectionEditor] = useState<SectionEditorTarget | null>(null)

  useEffect(() => {
    void initialize()
  }, [initialize])

  if (!isHydrated) {
    return <div className="loading-state">Lokale Datenbank wird geladen...</div>
  }

  return (
    <div className="app-shell">
      <StartOverlay />
      <AdminPanel />
      {activeCase && sectionEditor ? <SectionEditorModal target={sectionEditor} record={activeCase} masterData={data.masterData} onClose={() => setSectionEditor(null)} /> : null}

      <header className="topbar">
        <div><p className="eyebrow">ELB Erfassung</p><h1>Desktop Phase 1</h1></div>
        <div className="topbar-actions">
          <button type="button" className="secondary-button" onClick={() => useAppStore.getState().selectClerk(null)}>Sachbearbeiter wechseln</button>
          <button type="button" className="primary-button" onClick={() => setAdminOpen(true)}>Admin Panel</button>
        </div>
      </header>

      <nav className="route-nav">
        {routeItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => clsx('route-link', isActive && 'active')}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="content-layout">
        <CaseSidebar activeCase={activeCase} />
        <main className="main-panel">
          {!activeCase ? (
            <div className="empty-state">Bitte zuerst einen Sachbearbeiter auswaehlen.</div>
          ) : (
            <Routes>
              <Route path="/" element={<EinliefererPage record={activeCase} masterData={data.masterData} />} />
              <Route path="/objekte" element={<ObjectEditor record={activeCase} masterData={data.masterData} />} />
              <Route path="/interne-infos" element={<InterneInfosPage record={activeCase} masterData={data.masterData} />} />
              <Route path="/pdf-vorschau" element={<PdfPreviewPage record={activeCase} masterData={data.masterData} onEdit={setSectionEditor} />} />
              <Route path="/word-vorschau" element={<WordPreviewPage record={activeCase} masterData={data.masterData} onEdit={setSectionEditor} />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  )
}

export default App

