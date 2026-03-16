import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import clsx from 'clsx'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import JSZip from 'jszip'
import { availableRequiredFields } from './app/defaults'
import {
  buildElbPdf,
  buildWordDocx,
  downloadElbPdf,
  downloadObjectsPdf,
  downloadWordDocx,
  downloadWordPdf,
  exportAllArtifacts,
} from './app/exports'
import { formatSwissNumber, getEffectiveBeneficiary } from './app/format'
import { useAppStore } from './app/store'
import {
  buildPdfPreviewPages as buildPdfPreviewPagesFromMap,
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

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Script konnte nicht geladen werden: ${src}`)), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.src = src
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolve()
    }, { once: true })
    script.addEventListener('error', () => reject(new Error(`Script konnte nicht geladen werden: ${src}`)), { once: true })
    document.head.appendChild(script)
  })

type SectionEditorTarget =
  | { type: 'consignor' }
  | { type: 'clerk' }
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

const formatObjectSelectLabel = (item: ObjectItem, index: number, total: number) =>
  `Objekt ${index + 1}/${total} - ${item.intNo || '-'} - ${item.shortDesc || 'Ohne Kurzbeschrieb'}`

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

const isIbidObject = (masterData: MasterData, auctionId: string) =>
  (masterData.auctions.find((entry) => entry.id === auctionId)?.number ?? '').toLowerCase().startsWith('ibid')

const getLimitLabel = (isIbid: boolean, netLimit: boolean) =>
  isIbid ? 'Startpreis' : netLimit ? 'Nettolimite' : 'Limite'

const buildPdfPreviewPages = (record: CaseRecord, masterData: MasterData): PreviewPage[] =>
  buildPdfPreviewPagesFromMap(record, masterData)

const editTargetFromKey = (editKey?: string): SectionEditorTarget | null => {
  if (!editKey) {
    return null
  }
  if (editKey.startsWith('object:')) {
    return { type: 'object', objectId: editKey.replace('object:', '') }
  }
  if (editKey === 'consignor' || editKey === 'clerk' || editKey === 'owner' || editKey === 'bank' || editKey === 'costs' || editKey === 'internal' || editKey === 'signature') {
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

const readSingleFileAsDataUrl = async (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const loadCaseRecordFromFile = async (file: File) => {
  if (file.name.toLowerCase().endsWith('.zip')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const payload = await zip.file('payload.json')?.async('string')
    if (!payload) {
      throw new Error('In der ZIP-Datei wurde keine payload.json gefunden.')
    }
    return JSON.parse(payload) as CaseRecord
  }
  return JSON.parse(await file.text()) as CaseRecord
}

const useActiveCase = () => {
  const data = useAppStore((state) => state.data)
  return useMemo(() => data.cases.find((record) => record.id === data.activeCaseId) ?? null, [data.activeCaseId, data.cases])
}

const TextField = ({
  label,
  value,
  onChange,
  textarea,
  type = 'text',
  readOnly,
  disabled,
  inputMode,
  placeholder,
  help,
  title,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  textarea?: boolean
  type?: string
  readOnly?: boolean
  disabled?: boolean
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search'
  placeholder?: string
  help?: string
  title?: string
  className?: string
}) => (
  <label className={clsx('field', className)}>
    <span title={title}>{label}</span>
    {textarea ? (
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} readOnly={readOnly} disabled={disabled} placeholder={placeholder} />
    ) : (
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} disabled={disabled} inputMode={inputMode} placeholder={placeholder} />
    )}
    {help ? <small>{help}</small> : null}
  </label>
)

const NumberField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
  <TextField
    label={label}
    value={value}
    onChange={(next) => onChange(formatSwissNumber(next))}
    inputMode="numeric"
    placeholder="0"
  />
)

const CheckboxField = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) => (
  <label className={clsx('checkbox-field', disabled && 'disabled')}>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
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

const CaseListModal = ({ activeCase, onClose }: { activeCase: CaseRecord | null; onClose: () => void }) => {
  const data = useAppStore((state) => state.data)
  const createCase = useAppStore((state) => state.createCase)
  const setActiveCase = useAppStore((state) => state.setActiveCase)
  const selectedCases = data.cases.filter((record) => record.clerkId === data.selectedClerkId)

  return (
    <div className="overlay">
      <div className="overlay-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Vorgaenge</p>
            <h2>{data.masterData.clerks.find((clerk) => clerk.id === data.selectedClerkId)?.name ?? 'Kein Sachbearbeiter'}</h2>
          </div>
          <div className="inline-actions">
            <button type="button" className="secondary-button" onClick={createCase}>Neuer Vorgang</button>
            <button type="button" className="ghost-button" onClick={onClose}>Schliessen</button>
          </div>
        </div>
        <div className="case-list case-modal-list">
          {selectedCases.map((record) => (
            <button key={record.id} type="button" className={clsx('case-item', activeCase?.id === record.id && 'active')} onClick={() => {
              setActiveCase(record.id)
              onClose()
            }}>
              <strong>{record.meta.receiptNo || 'Unbenannt'}</strong>
              <span>{record.consignor.lastName || 'Einlieferer offen'}</span>
              <small>Revision {record.revision}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
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
  const beneficiaryName = getEffectiveBeneficiary(record)
  const companySelected = record.consignor.captureCompanyAddress

  return (
    <div className="page-stack">
      <SectionCard title="Meta" description="ELB-Nummer, Datum und globale Vorgangsdaten">
        <TextField label="ELB-Nummer" value={record.meta.receiptNo} onChange={(value) => updateField('meta.receiptNo', value)} />
        <TextField label="Datum" type="date" value={record.meta.date} onChange={(value) => updateField('meta.date', value)} />
        <TextField label="Kundennummer" value={record.consignor.customerNo} onChange={(value) => updateField('consignor.customerNo', value)} />
      </SectionCard>

      <SectionCard title="Einlieferer" description="Adress- und Personendaten">
        <CheckboxField label="Firmenadresse" checked={record.consignor.captureCompanyAddress} onChange={(value) => updateField('consignor.captureCompanyAddress', value)} />
        <SelectField label="Anrede" value={record.consignor.title} onChange={(value) => updateField('consignor.title', value)} options={masterData.titles.map((title) => ({ value: title, label: title }))} />
        {companySelected ? <TextField className="span-two" label="Firma" value={record.consignor.company} onChange={(value) => updateField('consignor.company', value)} /> : null}
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
      </SectionCard>

      <SectionCard title="Personendaten" description="Geburtsdatum, Nationalität, Ausweis und Passfoto">
        <TextField label="Geburtsdatum" type="date" value={record.consignor.birthdate} onChange={(value) => updateField('consignor.birthdate', value)} />
        <TextField label="Nationalität" value={record.consignor.nationality} onChange={(value) => updateField('consignor.nationality', value)} />
        <TextField label="ID-/Passnummer" value={record.consignor.passportNo} onChange={(value) => updateField('consignor.passportNo', value)} />
        <div className="field photo-field">
          <span>Passfoto</span>
          <label className="file-button">
            Foto hochladen
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) {
                  return
                }
                updateField('consignor.passportPhoto', await readSingleFileAsDataUrl(file))
                event.target.value = ''
              }}
            />
          </label>
          {record.consignor.passportPhoto ? (
            <div className="passport-preview">
              <img src={record.consignor.passportPhoto} alt="Passfoto" />
              <button type="button" className="photo-remove" onClick={() => updateField('consignor.passportPhoto', '')} aria-label="Passfoto entfernen">x</button>
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Eigentümer" description="Eigentümerdaten liegen auf derselben Seite">
        <CheckboxField label="Eigentümer entspricht Einlieferer" checked={record.owner.sameAsConsignor} onChange={(value) => updateField('owner.sameAsConsignor', value)} />
        {!record.owner.sameAsConsignor ? (
          <>
            <TextField label="Vorname" value={record.owner.firstName} onChange={(value) => updateField('owner.firstName', value)} />
            <TextField label="Nachname" value={record.owner.lastName} onChange={(value) => updateField('owner.lastName', value)} />
            <TextField label="Strasse" value={record.owner.street} onChange={(value) => updateField('owner.street', value)} />
            <TextField label="Hausnummer" value={record.owner.houseNo} onChange={(value) => updateField('owner.houseNo', value)} />
            <TextField label="PLZ" value={record.owner.zip} onChange={(value) => updateField('owner.zip', value)} />
            <TextField label="Stadt" value={record.owner.city} onChange={(value) => updateField('owner.city', value)} />
            <TextField label="Land" value={record.owner.country} onChange={(value) => updateField('owner.country', value)} />
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="Bank" description="Bankdaten des gesamten Vorgangs">
        <TextField label="Begünstigter" value={beneficiaryName} onChange={() => undefined} readOnly help="Wird automatisch aus Firma oder Vorname/Nachname gebildet." />
        <TextField label="IBAN" value={record.bank.iban} onChange={(value) => updateField('bank.iban', value)} />
        <TextField label="BIC" value={record.bank.bic} onChange={(value) => updateField('bank.bic', value)} />
        <CheckboxField label="Abweichender Begünstigter" checked={record.bank.diffBeneficiary} onChange={(value) => updateField('bank.diffBeneficiary', value)} />
        {record.bank.diffBeneficiary ? (
          <>
            <TextField
              label="Grund für abweichenden Begünstigten"
              value={record.bank.diffReason}
              onChange={(value) => updateField('bank.diffReason', value)}
              textarea
              help={!record.bank.diffReason.trim() ? 'Grund fehlt noch.' : undefined}
              title={!record.bank.diffReason.trim() ? 'Bitte zuerst den Grund angeben, damit der Name aktiviert wird.' : undefined}
            />
            <TextField
              label="Name abweichender Begünstigter"
              value={record.bank.diffBeneficiaryName}
              onChange={(value) => updateField('bank.diffBeneficiaryName', value)}
              disabled={!record.bank.diffReason.trim()}
              help={!record.bank.diffReason.trim() ? 'Wird erst aktiv, sobald ein Grund erfasst ist.' : undefined}
            />
          </>
        ) : null}
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
  const [activeObjectId, setActiveObjectId] = useState(selectedObjectId ?? record.objects[0]?.id ?? '')
  const effectiveObjectId =
    selectedObjectId ??
    (record.objects.some((item) => item.id === activeObjectId) ? activeObjectId : record.objects[0]?.id ?? '')

  const objects = selectedObjectId
    ? record.objects.filter((item) => item.id === selectedObjectId)
    : record.objects.filter((item) => item.id === effectiveObjectId)

  const handleAddObject = () => {
    const lastObject = record.objects.at(-1)
    const nextObjectId = addObject({
      auctionId: lastObject?.auctionId ?? '',
      departmentId: lastObject?.departmentId ?? '',
    })
    if (nextObjectId) {
      setActiveObjectId(nextObjectId)
    }
  }

  return (
    <div className={clsx('page-stack', inModal && 'compact-stack')}>
      {!selectedObjectId ? (
        <div className="toolbar">
          <div>
            <p className="eyebrow">Objektverwaltung</p>
            <h3>{record.objects.length} Objekte im Vorgang</h3>
          </div>
          <div className="toolbar-actions">
            <label className="compact-select">
              <span>Objekt</span>
              <select value={effectiveObjectId} onChange={(event) => setActiveObjectId(event.target.value)}>
                {record.objects.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {formatObjectSelectLabel(item, index, record.objects.length)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primary-button" onClick={handleAddObject}>Objekt hinzufuegen</button>
          </div>
        </div>
      ) : null}
      {objects.map((item) => {
        const objectIndex = record.objects.findIndex((entry) => entry.id === item.id)
        const isIbid = isIbidObject(masterData, item.auctionId)
        const limitLabel = getLimitLabel(isIbid, item.netLimit)
        return (
          <section key={item.id} className="card">
            <div className="card-header split">
              <div>
                <h3>{formatObjectLabel(item, objectIndex)}</h3>
                <p>{getAuctionLabel(masterData, item.auctionId) || 'Auktion noch nicht gewaehlt'}</p>
              </div>
              {record.objects.length > 1 ? <button type="button" className="ghost-button" onClick={() => removeObject(item.id)}>Entfernen</button> : null}
            </div>
            <div className="field-grid">
              <TextField label="Int.-Nr." value={item.intNo} onChange={(value) => updateField(`objects[${objectIndex}].intNo`, value)} />
              <SelectField label="Auktion" value={item.auctionId} onChange={(value) => {
                updateField(`objects[${objectIndex}].auctionId`, value)
                if (isIbidObject(masterData, value) && item.netLimit) {
                  updateField(`objects[${objectIndex}].netLimit`, false)
                }
              }} options={masterData.auctions.map((auction) => ({ value: auction.id, label: `${auction.number} / ${auction.month} ${auction.year}` }))} />
              <SelectField label="Abteilung" value={item.departmentId} onChange={(value) => updateField(`objects[${objectIndex}].departmentId`, value)} options={masterData.departments.map((department) => ({ value: department.id, label: `${department.code} - ${department.name}` }))} />
              <TextField className="span-two" label="Kurzbeschreibung" value={item.shortDesc} onChange={(value) => updateField(`objects[${objectIndex}].shortDesc`, value)} />
              <TextField className="span-two" label="Beschreibung" value={item.desc} onChange={(value) => updateField(`objects[${objectIndex}].desc`, value)} textarea />
              <NumberField label="Schaetzung von" value={item.estimateLow} onChange={(value) => updateField(`objects[${objectIndex}].estimateLow`, value)} />
              <NumberField label="Schaetzung bis" value={item.estimateHigh} onChange={(value) => updateField(`objects[${objectIndex}].estimateHigh`, value)} />
              <NumberField label={limitLabel} value={item.limit} onChange={(value) => updateField(`objects[${objectIndex}].limit`, value)} />
              <CheckboxField label="Nettolimite" checked={item.netLimit} onChange={(value) => updateField(`objects[${objectIndex}].netLimit`, value)} disabled={isIbid} />
              {isIbid ? <p className="field-help span-two">Bei ibid-Objekten ist keine Nettolimite erlaubt. Das Feld wird als Startpreis ausgegeben.</p> : null}
              <NumberField label="Abb.-Kosten" value={item.abbCost} onChange={(value) => updateField(`objects[${objectIndex}].abbCost`, value)} />
              <TextField label="Referenznr." value={item.received} onChange={(value) => updateField(`objects[${objectIndex}].received`, value)} />
              <TextField label="Bemerkungen" value={item.remarks} onChange={(value) => updateField(`objects[${objectIndex}].remarks`, value)} textarea />
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
                    <div key={photo.id} className="passport-preview">
                      <img src={photo.dataUrl} alt={photo.name} />
                      <button type="button" className="photo-remove" onClick={() => removePhoto(item.id, photo.id)} aria-label="Foto entfernen">x</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })}

      {!selectedObjectId ? (
        <SectionCard title="Konditionen" description="Diese Konditionen gelten fuer alle Objekte des Vorgangs">
          <NumberField label="Kommission" value={record.costs.kommission} onChange={(value) => updateField('costs.kommission', value)} />
          <NumberField label="Versicherung" value={record.costs.versicherung} onChange={(value) => updateField('costs.versicherung', value)} />
          <NumberField label="Transport" value={record.costs.transport} onChange={(value) => updateField('costs.transport', value)} />
          <NumberField label="Abb.-Kosten" value={record.costs.abbKosten} onChange={(value) => updateField('costs.abbKosten', value)} />
          <NumberField label="Kosten Expertisen" value={record.costs.kostenExpertisen} onChange={(value) => updateField('costs.kostenExpertisen', value)} />
          <NumberField label="Internet" value={record.costs.internet} onChange={(value) => updateField('costs.internet', value)} />
          <CheckboxField label="Alle Kosten nur bei Erfolg" checked={record.costs.onlyIfSuccess} onChange={(value) => updateField('costs.onlyIfSuccess', value)} />
          <TextField label="Provenienz / Diverses" value={record.costs.provenance} onChange={(value) => updateField('costs.provenance', value)} textarea />
        </SectionCard>
      ) : null}
    </div>
  )
}

const InterneInfosPage = ({ record, masterData }: { record: CaseRecord; masterData: MasterData }) => {
  const updateField = useAppStore((state) => state.updateField)

  return (
    <div className="page-stack">
      <SectionCard title="Interne Notizen">
        <TextField className="span-two" label="Notiz" value={record.internalInfo.note} onChange={(value) => updateField('internalInfo.note', value)} textarea />
      </SectionCard>
      <SectionCard title="Interessengebiete" description="Mehrfachauswahl aus der zentralen Stammdatenliste">
        <MultiSelectField label="Interessengebiete" values={record.internalInfo.interestIds} onChange={(values) => updateField('internalInfo.interestIds', values)} options={masterData.departments.map((department) => ({ value: department.id, label: `${department.code} - ${department.name}` }))} />
      </SectionCard>
    </div>
  )
}

const RenderedPreviewSurface = ({
  pages,
  pdfFactory,
  onFieldClick,
}: {
  pages: PreviewPage[]
  pdfFactory: () => Promise<Uint8Array>
  onFieldClick?: (editKey?: string) => void
}) => {
  const [images, setImages] = useState<string[]>([])

  useEffect(() => {
    let active = true

    const renderPages = async () => {
      const pdfBytes = await pdfFactory()
      const pdf = await getDocument({ data: pdfBytes }).promise
        const nextImages: string[] = []

        for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
          const pdfPage = await pdf.getPage(pageIndex + 1)
          const deviceScale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
          const renderScale = Math.max(2.4, deviceScale * 2)
          const viewport = pdfPage.getViewport({ scale: renderScale })
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) {
            continue
          }
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'
          canvas.width = viewport.width
          canvas.height = viewport.height
          await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
          nextImages.push(canvas.toDataURL('image/png'))
        }

      if (active) {
        setImages(nextImages)
      }
    }

    void renderPages()

    return () => {
      active = false
    }
  }, [pdfFactory])

  return (
    <div className="preview-pages">
      {pages.map((page, index) => (
        <article key={page.id} className={clsx('preview-page', page.kind)}>
          <header>
            <p className="eyebrow">{page.title}</p>
            <h3>{page.subtitle}</h3>
          </header>
          <div className="document-surface rendered">
            {images[index] ? <img src={images[index]} alt={page.title} className="document-image" /> : <div className="document-loading">Dokument wird gerendert...</div>}
            {page.fields.map((field) => (
              <button
                key={field.id}
                type="button"
                className="preview-field"
                onClick={() => onFieldClick?.(field.editKey)}
                title={field.label}
                style={{ left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.w * 100}%`, height: `${field.h * 100}%` }}
              >
                <span>{field.value || field.label}</span>
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  )
}

const WordDocxPreviewSurface = ({
  docxFactory,
}: {
  docxFactory: () => Promise<Blob>
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true
    let resizeObserver: ResizeObserver | null = null

    const fitPages = () => {
      const host = hostRef.current
      if (!host) {
        return
      }
      const pages = Array.from(host.querySelectorAll<HTMLElement>('.docx'))
      const availableWidth = host.clientWidth - 24
      pages.forEach((page) => {
        page.style.transform = ''
        page.style.transformOrigin = 'top center'
        page.style.marginBottom = '18px'
        const pageWidth = page.scrollWidth
        if (!pageWidth || pageWidth <= availableWidth) {
          page.style.height = ''
          return
        }
        const scale = availableWidth / pageWidth
        page.style.transform = `scale(${scale})`
        page.style.height = `${page.scrollHeight * scale}px`
      })
    }

    const renderDocx = async () => {
      const host = hostRef.current
      if (!host) {
        return
      }
      host.innerHTML = ''
      await loadScript('/vendor/jszip.min.js')
      await loadScript('/vendor/docx-preview.js')
      const blob = await docxFactory()
      if (!active) {
        return
      }
      const renderer = (window as Window & { docx?: { renderAsync?: (data: Blob, bodyContainer: HTMLElement, styleContainer?: HTMLElement, options?: Record<string, unknown>) => Promise<void> } }).docx?.renderAsync
      if (!renderer) {
        throw new Error('docx-preview konnte nicht initialisiert werden.')
      }
      await renderer(blob, host, undefined, {
        className: 'word-docx-preview',
        inWrapper: true,
        breakPages: true,
        ignoreWidth: false,
        ignoreHeight: false,
      })
      fitPages()
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => fitPages())
        resizeObserver.observe(host)
      }
    }

    void renderDocx()

    return () => {
      active = false
      resizeObserver?.disconnect()
    }
  }, [docxFactory])

  return <div ref={hostRef} className="docx-preview-host" />
}

const clearSignatureCanvas = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#0f172a'
  context.lineWidth = 2.4
  context.lineJoin = 'round'
  context.lineCap = 'round'
}

const getCanvasPoint = (canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) => {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

const drawSignaturePreview = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, value: string) => {
  clearSignatureCanvas(canvas, context)
  if (!value) {
    return
  }
  const image = new Image()
  image.onload = () => {
    const padding = 12
    const scale = Math.min(
      (canvas.width - padding * 2) / image.width,
      (canvas.height - padding * 2) / image.height,
    )
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(
      image,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    )
  }
  image.src = value
}

const SignaturePad = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const internalUpdateRef = useRef(false)
  const [drawing, setDrawing] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return
    }
    if (internalUpdateRef.current) {
      internalUpdateRef.current = false
      return
    }
    drawSignaturePreview(canvas, context, value)
  }, [value])

  const updateFromCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    internalUpdateRef.current = true
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
            const point = getCanvasPoint(canvas, event)
            context.beginPath()
            context.moveTo(point.x, point.y)
            context.lineTo(point.x, point.y)
            context.stroke()
            canvas.setPointerCapture(event.pointerId)
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
            const point = getCanvasPoint(canvas, event)
            context.lineTo(point.x, point.y)
            context.stroke()
          }}
          onPointerUp={(event) => {
            const canvas = canvasRef.current
            setDrawing(false)
            canvas?.releasePointerCapture(event.pointerId)
            updateFromCanvas()
          }}
          onPointerLeave={(event) => {
            if (drawing) {
              const canvas = canvasRef.current
              setDrawing(false)
              canvas?.releasePointerCapture(event.pointerId)
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
          internalUpdateRef.current = false
          clearSignatureCanvas(canvas, context)
          onChange('')
        }}>Leeren</button></div>
      </div>
    )
  }
const SectionEditorModal = ({ target, record, masterData, onClose }: { target: SectionEditorTarget; record: CaseRecord; masterData: MasterData; onClose: () => void }) => {
  const updateField = useAppStore((state) => state.updateField)
  const addObject = useAppStore((state) => state.addObject)
  const beneficiaryName = getEffectiveBeneficiary(record)
  const companySelected = record.consignor.captureCompanyAddress
  const currentClerk = masterData.clerks.find((entry) => entry.id === record.clerkId)
  const [activeObjectId, setActiveObjectId] = useState(target.type === 'object' ? target.objectId : '')

  const handleAddObjectFromModal = () => {
    if (target.type !== 'object') {
      return
    }
    const lastObject = record.objects.at(-1)
    const nextObjectId = addObject({
      auctionId: lastObject?.auctionId ?? '',
      departmentId: lastObject?.departmentId ?? '',
    })
    if (nextObjectId) {
      setActiveObjectId(nextObjectId)
    }
  }

  return (
    <div className="overlay">
        <div className="overlay-card wide">
          <div className="modal-header">
            <div><p className="eyebrow">Vorschau-Modal</p><h2>Felder bearbeiten</h2></div>
            <div className="inline-actions">
              {target.type === 'object' ? (
                <button type="button" className="secondary-button" onClick={handleAddObjectFromModal}>Objekt hinzufuegen</button>
              ) : null}
              <button type="button" className="ghost-button" onClick={onClose}>Schließen/Übernehmen</button>
            </div>
          </div>

        {target.type === 'consignor' ? (
          <div className="field-grid">
            <CheckboxField label="Firmenadresse" checked={record.consignor.captureCompanyAddress} onChange={(value) => updateField('consignor.captureCompanyAddress', value)} />
            <SelectField label="Anrede" value={record.consignor.title} onChange={(value) => updateField('consignor.title', value)} options={masterData.titles.map((title) => ({ value: title, label: title }))} />
            <TextField label="Vorname" value={record.consignor.firstName} onChange={(value) => updateField('consignor.firstName', value)} />
            <TextField label="Nachname" value={record.consignor.lastName} onChange={(value) => updateField('consignor.lastName', value)} />
            {companySelected ? <TextField className="span-two" label="Firma" value={record.consignor.company} onChange={(value) => updateField('consignor.company', value)} /> : null}
            <TextField label="Adresszusatz" value={record.consignor.addressAddon1} onChange={(value) => updateField('consignor.addressAddon1', value)} />
            <TextField label="Strasse" value={record.consignor.street} onChange={(value) => updateField('consignor.street', value)} />
            <TextField label="Hausnummer" value={record.consignor.houseNo} onChange={(value) => updateField('consignor.houseNo', value)} />
            <TextField label="PLZ" value={record.consignor.zip} onChange={(value) => updateField('consignor.zip', value)} />
            <TextField label="Stadt" value={record.consignor.city} onChange={(value) => updateField('consignor.city', value)} />
            <TextField label="Land" value={record.consignor.country} onChange={(value) => updateField('consignor.country', value)} />
            <TextField label="E-Mail" value={record.consignor.email} onChange={(value) => updateField('consignor.email', value)} />
            <TextField label="Telefon" value={record.consignor.phone} onChange={(value) => updateField('consignor.phone', value)} />
            <TextField label="Geburtsdatum" type="date" value={record.consignor.birthdate} onChange={(value) => updateField('consignor.birthdate', value)} />
            <TextField label="Nationalität" value={record.consignor.nationality} onChange={(value) => updateField('consignor.nationality', value)} />
            <TextField label="ID-/Passnummer" value={record.consignor.passportNo} onChange={(value) => updateField('consignor.passportNo', value)} />
          </div>
        ) : null}

        {target.type === 'clerk' ? (
          <div className="field-grid single-column">
            <TextField label="Sachbearbeiter" value={currentClerk?.name ?? ''} onChange={() => undefined} readOnly />
            <TextField label="Telefon" value={currentClerk?.phone ?? ''} onChange={() => undefined} readOnly />
            <TextField label="E-Mail" value={currentClerk?.email ?? ''} onChange={() => undefined} readOnly />
          </div>
        ) : null}

        {target.type === 'owner' ? (
          <div className="field-grid">
            <CheckboxField label="Eigentümer entspricht Einlieferer" checked={record.owner.sameAsConsignor} onChange={(value) => updateField('owner.sameAsConsignor', value)} />
            {!record.owner.sameAsConsignor ? (
              <>
                <TextField label="Vorname" value={record.owner.firstName} onChange={(value) => updateField('owner.firstName', value)} />
                <TextField label="Nachname" value={record.owner.lastName} onChange={(value) => updateField('owner.lastName', value)} />
                <TextField label="Strasse" value={record.owner.street} onChange={(value) => updateField('owner.street', value)} />
                <TextField label="Hausnummer" value={record.owner.houseNo} onChange={(value) => updateField('owner.houseNo', value)} />
                <TextField label="PLZ" value={record.owner.zip} onChange={(value) => updateField('owner.zip', value)} />
                <TextField label="Stadt" value={record.owner.city} onChange={(value) => updateField('owner.city', value)} />
                <TextField label="Land" value={record.owner.country} onChange={(value) => updateField('owner.country', value)} />
              </>
            ) : null}
          </div>
        ) : null}

        {target.type === 'bank' ? (
          <div className="field-grid">
            <TextField label="Begünstigter" value={beneficiaryName} onChange={() => undefined} readOnly help="Automatisch zusammengesetzt." />
            <TextField label="IBAN" value={record.bank.iban} onChange={(value) => updateField('bank.iban', value)} />
            <TextField label="BIC" value={record.bank.bic} onChange={(value) => updateField('bank.bic', value)} />
            <CheckboxField label="Abweichender Begünstigter" checked={record.bank.diffBeneficiary} onChange={(value) => updateField('bank.diffBeneficiary', value)} />
            {record.bank.diffBeneficiary ? (
              <>
                <TextField
                  label="Grund"
                  value={record.bank.diffReason}
                  onChange={(value) => updateField('bank.diffReason', value)}
                  textarea
                  help={!record.bank.diffReason.trim() ? 'Grund fehlt noch.' : undefined}
                  title={!record.bank.diffReason.trim() ? 'Bitte Grund erfassen, damit der Name aktiviert wird.' : undefined}
                />
                <TextField
                  label="Name abweichender Begünstigter"
                  value={record.bank.diffBeneficiaryName}
                  onChange={(value) => updateField('bank.diffBeneficiaryName', value)}
                  disabled={!record.bank.diffReason.trim()}
                />
              </>
            ) : null}
          </div>
        ) : null}

        {target.type === 'costs' ? (
          <div className="field-grid">
            <NumberField label="Kommission" value={record.costs.kommission} onChange={(value) => updateField('costs.kommission', value)} />
            <NumberField label="Versicherung" value={record.costs.versicherung} onChange={(value) => updateField('costs.versicherung', value)} />
            <NumberField label="Transport" value={record.costs.transport} onChange={(value) => updateField('costs.transport', value)} />
            <NumberField label="Abb.-Kosten" value={record.costs.abbKosten} onChange={(value) => updateField('costs.abbKosten', value)} />
            <NumberField label="Kosten Expertisen" value={record.costs.kostenExpertisen} onChange={(value) => updateField('costs.kostenExpertisen', value)} />
            <NumberField label="Internet" value={record.costs.internet} onChange={(value) => updateField('costs.internet', value)} />
            <CheckboxField label="Alle Kosten nur bei Erfolg" checked={record.costs.onlyIfSuccess} onChange={(value) => updateField('costs.onlyIfSuccess', value)} />
            <TextField label="Provenienz / Diverses" value={record.costs.provenance} onChange={(value) => updateField('costs.provenance', value)} textarea />
          </div>
        ) : null}

        {target.type === 'internal' ? (
          <div className="field-grid">
            <TextField className="span-two" label="Interne Notiz" value={record.internalInfo.note} onChange={(value) => updateField('internalInfo.note', value)} textarea />
            <MultiSelectField label="Interessengebiete" values={record.internalInfo.interestIds} onChange={(values) => updateField('internalInfo.interestIds', values)} options={masterData.departments.map((department) => ({ value: department.id, label: `${department.code} - ${department.name}` }))} />
          </div>
        ) : null}

        {target.type === 'object' ? <ObjectEditor record={record} masterData={masterData} inModal selectedObjectId={activeObjectId} /> : null}
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
  const pages = useMemo(() => buildPdfPreviewPages(record, masterData), [record, masterData])
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
      <div className="preview-stack">
        <RenderedPreviewSurface
          pages={pages}
          pdfFactory={() => buildElbPdf(record, masterData)}
          onFieldClick={(editKey) => {
            const target = editTargetFromKey(editKey)
            if (target) {
              onEdit(target)
            }
          }}
        />
        <section className="card preview-actions-card">
          <div className="action-row">
            <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'signature' })}>Einlieferer unterschreiben</button>
            <button type="button" className="primary-button" onClick={() => void handleExport()}>Definitives ELB-PDF exportieren</button>
            <button type="button" className="secondary-button" onClick={() => void downloadObjectsPdf(record, masterData)}>Zusatz-PDF mit Objekten</button>
            <button type="button" className="secondary-button" onClick={() => void exportAllArtifacts(record, masterData)}>Finales ZIP erzeugen</button>
          </div>
        </section>
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
  return (
    <div className="preview-stack word-preview-stack">
      <WordDocxPreviewSurface docxFactory={() => buildWordDocx(record, masterData)} />
      <section className="card preview-actions-card">
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'consignor' })}>Einlieferer bearbeiten</button>
          <button type="button" className="secondary-button" onClick={() => onEdit({ type: 'object', objectId: record.objects[0]?.id ?? '' })} disabled={!record.objects.length}>Objekte bearbeiten</button>
          <button type="button" className="primary-button" onClick={() => void downloadWordDocx(record, masterData)}>Definitive DOCX-Datei</button>
          <button type="button" className="secondary-button" onClick={() => void downloadWordPdf(record, masterData, record.meta.receiptNo)}>PDF aus Word-Vorschau</button>
        </div>
      </section>
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

  const [draftClerk, setDraftClerk] = useState<Clerk>({ id: '', name: '', email: '', phone: '', signaturePng: '' })
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
              <section className="card compact-admin-card">
                <div className="compact-admin-form">
                  <TextField label="Name" value={draftClerk.name} onChange={(value) => setDraftClerk((current) => ({ ...current, name: value }))} />
                  <TextField label="E-Mail" value={draftClerk.email} onChange={(value) => setDraftClerk((current) => ({ ...current, email: value }))} />
                  <TextField label="Telefon" value={draftClerk.phone} onChange={(value) => setDraftClerk((current) => ({ ...current, phone: value }))} />
                  <div className="field admin-signature-field">
                    <span>Unterschrift</span>
                    <SignaturePad value={draftClerk.signaturePng ?? ''} onChange={(value) => setDraftClerk((current) => ({ ...current, signaturePng: value }))} />
                  </div>
                </div>
                <div className="inline-actions">
                  <button type="button" className="primary-button" onClick={() => {
                    if (!draftClerk.name.trim()) return
                    upsertClerk({ ...draftClerk, id: draftClerk.id || `clerk-${draftClerk.name.toLowerCase().replace(/\s+/g, '-')}` })
                    setDraftClerk({ id: '', name: '', email: '', phone: '', signaturePng: '' })
                  }}>Sachbearbeiter speichern</button>
                </div>
                <div className="admin-list">
                  {data.masterData.clerks.map((clerk) => (
                    <div key={clerk.id} className="list-row compact-row">
                      <div><strong>{clerk.name}</strong><span>{clerk.email}</span><small>{clerk.phone}</small></div>
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
              <section className="card compact-admin-card">
                <div className="compact-admin-form">
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
                    <div key={auction.id} className="list-row compact-row">
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
              <section className="card compact-admin-card">
                <div className="compact-admin-form">
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
                    <div key={department.id} className="list-row compact-row">
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
  const importCase = useAppStore((state) => state.importCase)
  const isHydrated = useAppStore((state) => state.isHydrated)
  const data = useAppStore((state) => state.data)
  const activeCase = useActiveCase()
  const [sectionEditor, setSectionEditor] = useState<SectionEditorTarget | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [casesOpen, setCasesOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
      {casesOpen ? <CaseListModal activeCase={activeCase} onClose={() => setCasesOpen(false)} /> : null}
      {activeCase && sectionEditor ? (
        <SectionEditorModal
          key={sectionEditor.type === 'object' ? `object-${sectionEditor.objectId}` : sectionEditor.type}
          target={sectionEditor}
          record={activeCase}
          masterData={data.masterData}
          onClose={() => setSectionEditor(null)}
        />
      ) : null}

      <header className="topbar">
        <div><p className="eyebrow">ELB Erfassung</p><h1>Desktop Phase 1</h1></div>
      </header>

      <nav className="route-nav">
        {routeItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => clsx('route-link', isActive && 'active')}>
            {item.label}
          </NavLink>
        ))}
        <div className="menu-anchor">
          <button type="button" className="primary-button compact-menu-button" onClick={() => setMenuOpen((current) => !current)}>Menue</button>
          {menuOpen ? (
            <div className="menu-dropdown">
              <button type="button" className="menu-item" onClick={() => {
                setCasesOpen(true)
                setMenuOpen(false)
              }}>Vorgaenge</button>
              <button type="button" className="menu-item" onClick={() => {
                setAdminOpen(true)
                setMenuOpen(false)
              }}>Admin</button>
              <button type="button" className="menu-item" onClick={() => {
                useAppStore.getState().selectClerk(null)
                setMenuOpen(false)
              }}>Sachbearbeiter wechseln</button>
              <button type="button" className="menu-item" onClick={() => {
                fileInputRef.current?.click()
                setMenuOpen(false)
              }}>Alte Vorgaenge laden</button>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) {
                return
              }
              try {
                const imported = await loadCaseRecordFromFile(file)
                importCase(imported)
              } catch (error) {
                window.alert(error instanceof Error ? error.message : 'Vorgang konnte nicht geladen werden.')
              } finally {
                event.target.value = ''
              }
            }}
          />
        </div>
      </nav>

      <main className="main-panel solo-panel">
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
  )
}

export default App

