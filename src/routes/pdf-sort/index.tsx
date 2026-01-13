import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'
import { zipSync } from 'fflate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
}

export const Route = createFileRoute('/pdf-sort/')({
  ssr: false,
  component: RouteComponent,
})

const MAX_FILES = 100
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// Types
interface FileData {
  file: File
  key: string
  isPdf: boolean
  url?: string
}

interface PdfMetadata {
  distributor: string
  invoiceNumber: string
  date: string
}

type PdfStatus = 'ready' | 'missing' | 'invalid'

// Utility functions
function getFileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`
}

function sanitizeSegment(segment: string): string {
  return segment
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validateSegment(segment: string): boolean {
  return sanitizeSegment(segment).length > 0
}

function RouteComponent() {
  const [files, setFiles] = useState<FileData[]>([])
  const [selectedPdfKey, setSelectedPdfKey] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<Record<string, PdfMetadata>>({})
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [isAskingPrefix, setIsAskingPrefix] = useState(false)
  const [prefixValue, setPrefixValue] = useState('')
  const [error, setError] = useState('')
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previewContainerRef = useRef<HTMLDivElement>(null)

  const pdfFiles = files.filter((f) => f.isPdf)
  const otherFiles = files.filter((f) => !f.isPdf)
  const selectedPdf = pdfFiles.find((f) => f.key === selectedPdfKey)
  const isAtLimit = files.length >= MAX_FILES

  // Measure preview container width
  useEffect(() => {
    const updateWidth = () => {
      if (previewContainerRef.current) {
        setContainerWidth(previewContainerRef.current.offsetWidth - 32) // Subtract padding
      }
    }

    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [selectedPdf])

  // Initialize metadata for new PDFs
  useEffect(() => {
    const newMetadata = { ...metadata }
    let hasChanges = false

    pdfFiles.forEach((pdf) => {
      if (!newMetadata[pdf.key]) {
        newMetadata[pdf.key] = {
          distributor: '',
          invoiceNumber: '',
          date: '',
        }
        hasChanges = true
      }
    })

    if (hasChanges) {
      setMetadata(newMetadata)
    }
  }, [pdfFiles.length])

  // Create blob URLs for PDFs
  useEffect(() => {
    const updatedFiles = files.map((fileData) => {
      if (fileData.isPdf && !fileData.url) {
        return {
          ...fileData,
          url: URL.createObjectURL(fileData.file),
        }
      }
      return fileData
    })

    if (updatedFiles.some((f, i) => f.url !== files[i]?.url)) {
      setFiles(updatedFiles)
    }

    // Cleanup
    return () => {
      files.forEach((f) => {
        if (f.url) {
          URL.revokeObjectURL(f.url)
        }
      })
    }
  }, [files.length])

  const handleFileSelect = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return

      const newFiles = Array.from(fileList)

      if (files.length + newFiles.length > MAX_FILES) {
        setError(
          `Cannot add ${newFiles.length} files. Limit is ${MAX_FILES} files total. Currently: ${files.length}`,
        )
        return
      }

      setError('')

      const fileDataArray: FileData[] = newFiles.map((file) => ({
        file,
        key: getFileKey(file),
        isPdf:
          file.type === 'application/pdf' ||
          file.name.toLowerCase().endsWith('.pdf'),
      }))

      setFiles([...files, ...fileDataArray])
    },
    [files],
  )

  const handleRemoveFile = useCallback(
    (key: string) => {
      const fileToRemove = files.find((f) => f.key === key)
      if (fileToRemove?.url) {
        URL.revokeObjectURL(fileToRemove.url)
      }

      setFiles(files.filter((f) => f.key !== key))

      if (selectedPdfKey === key) {
        setSelectedPdfKey(null)
      }

      // Remove metadata
      const newMetadata = { ...metadata }
      delete newMetadata[key]
      setMetadata(newMetadata)
    },
    [files, selectedPdfKey, metadata],
  )

  const handleClearAll = useCallback(() => {
    files.forEach((f) => {
      if (f.url) {
        URL.revokeObjectURL(f.url)
      }
    })
    setFiles([])
    setMetadata({})
    setSelectedPdfKey(null)
    setError('')
  }, [files])

  const handlePdfSelect = useCallback((key: string) => {
    setSelectedPdfKey(key)
    setPageNumber(1) // Reset to page 1 on selection
  }, [])

  const handleMetadataChange = useCallback(
    (key: string, field: keyof PdfMetadata, value: string) => {
      setMetadata({
        ...metadata,
        [key]: {
          ...metadata[key],
          [field]: value,
        },
      })
    },
    [metadata],
  )

  const getPdfStatus = useCallback(
    (
      key: string,
      includePrefix: boolean = false,
    ): { status: PdfStatus; message?: string } => {
      const meta = metadata[key]
      if (!meta) {
        return { status: 'missing', message: 'No metadata' }
      }

      const { distributor, invoiceNumber, date } = meta

      // Check if any field is empty
      if (!distributor || !invoiceNumber || !date) {
        return { status: 'missing', message: 'Missing fields' }
      }

      // Check date format
      if (!DATE_REGEX.test(date)) {
        return {
          status: 'invalid',
          message: 'Invalid date format (YYYY-MM-DD)',
        }
      }

      // Check sanitization
      if (!validateSegment(distributor)) {
        return {
          status: 'invalid',
          message: 'Invalid distributor (empty after sanitization)',
        }
      }

      if (!validateSegment(invoiceNumber)) {
        return {
          status: 'invalid',
          message: 'Invalid invoice number (empty after sanitization)',
        }
      }

      if (includePrefix && prefixValue && !validateSegment(prefixValue)) {
        return { status: 'invalid', message: 'Invalid prefix' }
      }

      return { status: 'ready' }
    },
    [metadata, prefixValue],
  )

  const allPdfsReady = useCallback(() => {
    return pdfFiles.every(
      (pdf) => getPdfStatus(pdf.key, true).status === 'ready',
    )
  }, [pdfFiles, getPdfStatus])

  const handleExportClick = useCallback(() => {
    if (!allPdfsReady()) {
      // Find first non-ready PDF and focus it
      const firstBlocking = pdfFiles.find(
        (pdf) => getPdfStatus(pdf.key, false).status !== 'ready',
      )
      if (firstBlocking) {
        setSelectedPdfKey(firstBlocking.key)
        setPageNumber(1)

        // Scroll into view
        setTimeout(() => {
          listRefs.current[firstBlocking.key]?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          })
        }, 100)
      }
      return
    }

    setIsAskingPrefix(true)
    setPrefixValue('')
  }, [allPdfsReady, pdfFiles, getPdfStatus])

  const handleCancelExport = useCallback(() => {
    setIsAskingPrefix(false)
    setPrefixValue('')
  }, [])

  const handleConfirmExport = useCallback(async () => {
    const sanitizedPrefix = sanitizeSegment(prefixValue)

    if (!sanitizedPrefix) {
      setError('Prefix is invalid (empty after sanitization)')
      return
    }

    setError('')

    try {
      // Build the zip
      const zipContents: Record<string, Uint8Array> = {}
      const usedNames = new Set<string>()

      // Add non-PDF files
      for (const fileData of otherFiles) {
        const buffer = await fileData.file.arrayBuffer()
        let filename = fileData.file.name
        let counter = 2

        // Handle collisions
        while (usedNames.has(filename)) {
          const dotIndex = fileData.file.name.lastIndexOf('.')
          if (dotIndex > 0) {
            const base = fileData.file.name.substring(0, dotIndex)
            const ext = fileData.file.name.substring(dotIndex)
            filename = `${base}-${counter}${ext}`
          } else {
            filename = `${fileData.file.name}-${counter}`
          }
          counter++
        }

        usedNames.add(filename)
        zipContents[filename] = new Uint8Array(buffer)
      }

      // Add PDF files with renamed filenames
      for (const fileData of pdfFiles) {
        const meta = metadata[fileData.key]
        const sanitizedDistributor = sanitizeSegment(meta.distributor)
        const sanitizedInvoice = sanitizeSegment(meta.invoiceNumber)
        const sanitizedDate = meta.date.trim()

        let filename = `${sanitizedPrefix}-${sanitizedDistributor}-${sanitizedInvoice}-${sanitizedDate}.pdf`
        let counter = 2

        // Handle collisions
        while (usedNames.has(filename)) {
          filename = `${sanitizedPrefix}-${sanitizedDistributor}-${sanitizedInvoice}-${sanitizedDate}-${counter}.pdf`
          counter++
        }

        usedNames.add(filename)

        const buffer = await fileData.file.arrayBuffer()
        zipContents[filename] = new Uint8Array(buffer)
      }

      // Create zip
      const zipped = zipSync(zipContents, { level: 6 })

      // Trigger download
      const blob = new Blob([new Uint8Array(zipped)], {
        type: 'application/zip',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${sanitizedPrefix}-export.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      // Reset export UI
      setIsAskingPrefix(false)
      setPrefixValue('')
    } catch (err) {
      setError(
        `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    }
  }, [prefixValue, pdfFiles, otherFiles, metadata])

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages)
    },
    [],
  )

  const goToPrevPage = useCallback(() => {
    setPageNumber((prev) => Math.max(1, prev - 1))
  }, [])

  const goToNextPage = useCallback(() => {
    setPageNumber((prev) => (numPages ? Math.min(numPages, prev + 1) : prev))
  }, [numPages])

  return (
    <div className="p-6 w-full">
      <h1 className="text-3xl font-bold mb-6">PDF Sort & Rename</h1>

      {/* Upload section */}
      <div className="mb-6 p-4 border rounded-lg bg-gray-50">
        <div className="flex items-center gap-4">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isAtLimit}
            variant={isAtLimit ? 'outline' : 'default'}
          >
            {isAtLimit ? 'Limit Reached' : 'Upload Files'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="*/*"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
            disabled={isAtLimit}
          />
          {files.length > 0 && (
            <Button onClick={handleClearAll} variant="outline">
              Clear All
            </Button>
          )}
          <span className="text-sm text-gray-600">
            {files.length} / {MAX_FILES} files ({pdfFiles.length} PDFs,{' '}
            {otherFiles.length} other)
          </span>
        </div>
        {isAtLimit && (
          <p className="text-sm text-orange-600 mt-2">
            Limit reached ({MAX_FILES} files). Remove files to add more.
          </p>
        )}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Main content */}
      {files.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No files uploaded yet.</p>
          <p className="text-sm mt-2">
            Upload files to get started. PDFs will be processed and renamed.
          </p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* PDF List */}
          <div className="lg:w-1/4">
            <h2 className="text-xl font-semibold mb-4">
              PDFs ({pdfFiles.length})
            </h2>
            <div className="space-y-2 max-h-150 overflow-y-auto">
              {pdfFiles.map((pdf) => {
                const { status, message } = getPdfStatus(pdf.key, false)
                const isSelected = selectedPdfKey === pdf.key

                return (
                  <div
                    key={pdf.key}
                    ref={(el) => {
                      listRefs.current[pdf.key] = el
                    }}
                    onClick={() => handlePdfSelect(pdf.key)}
                    className={`p-3 border rounded cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          title={pdf.file.name}
                        >
                          {pdf.file.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(pdf.file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            status === 'ready'
                              ? 'bg-green-100 text-green-800'
                              : status === 'missing'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {status}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveFile(pdf.key)
                          }}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {message && (
                      <p className="text-xs text-gray-600 mt-1">{message}</p>
                    )}
                  </div>
                )
              })}
            </div>

            {otherFiles.length > 0 && (
              <>
                <h2 className="text-xl font-semibold mb-4 mt-6">
                  Other Files ({otherFiles.length})
                </h2>
                <div className="space-y-2 max-h-75 overflow-y-auto">
                  {otherFiles.map((file) => (
                    <div
                      key={file.key}
                      className="p-3 border rounded border-gray-200 bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            title={file.file.name}
                          >
                            {file.file.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {(file.file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveFile(file.key)}
                          className="text-xs text-red-600 hover:text-red-800"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* PDF Preview & Form */}
          <div className="lg:w-3/4 flex flex-col gap-6">
            {selectedPdf ? (
              <>
                {/* Metadata Form */}
                <div>
                  <h2 className="text-xl font-semibold mb-4">Metadata</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="distributor">Distributor *</Label>
                      <Input
                        id="distributor"
                        type="text"
                        value={metadata[selectedPdf.key]?.distributor || ''}
                        onChange={(e) =>
                          handleMetadataChange(
                            selectedPdf.key,
                            'distributor',
                            e.target.value,
                          )
                        }
                        placeholder="Enter distributor name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="invoice">Invoice Number *</Label>
                      <Input
                        id="invoice"
                        type="text"
                        value={metadata[selectedPdf.key]?.invoiceNumber || ''}
                        onChange={(e) =>
                          handleMetadataChange(
                            selectedPdf.key,
                            'invoiceNumber',
                            e.target.value,
                          )
                        }
                        placeholder="Enter invoice number"
                      />
                    </div>
                    <div>
                      <Label htmlFor="date">Date (YYYY-MM-DD) *</Label>
                      <Input
                        id="date"
                        type="date"
                        value={metadata[selectedPdf.key]?.date || ''}
                        onChange={(e) =>
                          handleMetadataChange(
                            selectedPdf.key,
                            'date',
                            e.target.value,
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-4 text-sm text-gray-600">
                    <p className="font-medium mb-2">Preview filename:</p>
                    {(() => {
                      const meta = metadata[selectedPdf.key]
                      if (
                        !meta ||
                        !meta.distributor ||
                        !meta.invoiceNumber ||
                        !meta.date
                      ) {
                        return (
                          <p className="text-gray-400 italic">
                            Complete all fields to see preview
                          </p>
                        )
                      }
                      const sanitizedDist = sanitizeSegment(meta.distributor)
                      const sanitizedInv = sanitizeSegment(meta.invoiceNumber)
                      const sanitizedDate = meta.date.trim()
                      return (
                        <p className="font-mono text-xs break-all">
                          [prefix]-{sanitizedDist}-{sanitizedInv}-
                          {sanitizedDate}.pdf
                        </p>
                      )
                    })()}
                  </div>
                </div>

                {/* Preview */}
                <div>
                  <h2 className="text-xl font-semibold mb-4">Preview</h2>
                  <div
                    ref={previewContainerRef}
                    className="border rounded p-4 bg-gray-50 flex flex-col items-center"
                  >
                    <Document
                      file={selectedPdf.url}
                      onLoadSuccess={onDocumentLoadSuccess}
                      loading={
                        <div className="text-center py-8">Loading PDF...</div>
                      }
                      error={
                        <div className="text-center py-8 text-red-600">
                          Failed to load PDF
                        </div>
                      }
                    >
                      <Page
                        pageNumber={pageNumber}
                        width={containerWidth || undefined}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                      />
                    </Document>
                    <div className="flex items-center justify-between mt-4 w-full">
                      <Button
                        onClick={goToPrevPage}
                        disabled={pageNumber <= 1}
                        variant="outline"
                        size="sm"
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {pageNumber} of {numPages || '?'}
                      </span>
                      <Button
                        onClick={goToNextPage}
                        disabled={!numPages || pageNumber >= numPages}
                        variant="outline"
                        size="sm"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg">
                  Select a PDF to preview and edit metadata
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export section */}
      {pdfFiles.length > 0 && (
        <div className="mt-6 p-4 border rounded-lg bg-gray-50">
          {!isAskingPrefix ? (
            <div>
              <Button
                onClick={handleExportClick}
                disabled={!allPdfsReady()}
                size="lg"
              >
                Export ZIP
              </Button>
              {!allPdfsReady() && (
                <p className="text-sm text-orange-600 mt-2">
                  {
                    pdfFiles.filter(
                      (pdf) => getPdfStatus(pdf.key, false).status !== 'ready',
                    ).length
                  }{' '}
                  PDF(s) need attention. Click to navigate to first issue.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="prefix">Export Prefix *</Label>
                <Input
                  id="prefix"
                  type="text"
                  value={prefixValue}
                  onChange={(e) => setPrefixValue(e.target.value)}
                  placeholder="Enter prefix for filenames"
                  autoFocus
                />
                <p className="text-xs text-gray-600 mt-1">
                  Files will be named:{' '}
                  {sanitizeSegment(prefixValue) || '[prefix]'}
                  -distributor-invoice-date.pdf
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleConfirmExport}
                  disabled={!validateSegment(prefixValue)}
                >
                  Confirm Export
                </Button>
                <Button onClick={handleCancelExport} variant="outline">
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
