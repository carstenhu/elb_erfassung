import type { CaseRecord } from './types'

const DIGITS_ONLY = /\D+/g

export const normalizeNumericInput = (value: string) => value.replace(DIGITS_ONLY, '')

export const formatSwissNumber = (value: string) => {
  const digits = normalizeNumericInput(value)
  if (!digits) {
    return ''
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

export const getDefaultBeneficiary = (record: CaseRecord) =>
  record.consignor.title === 'Firma'
    ? record.consignor.company.trim()
    : `${record.consignor.firstName} ${record.consignor.lastName}`.trim()

export const getEffectiveBeneficiary = (record: CaseRecord) => {
  if (record.bank.diffBeneficiary && record.bank.diffReason.trim() && record.bank.diffBeneficiaryName.trim()) {
    return record.bank.diffBeneficiaryName.trim()
  }
  return getDefaultBeneficiary(record)
}
