import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import Papa from 'papaparse'
import { FileUploader } from '@/components/FileUploader'

export const Route = createFileRoute('/cm2pohoda/')({
  component: RouteComponent,
})

interface ParsedCSVData {
  fields: string[]
  rows: string[][]
}

function RouteComponent() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<ParsedCSVData | null>(null)
  const [error, setError] = useState<string>('')

  const handleFile = (file: File) => {
    // Validate file type
    if (!file.name.endsWith('.csv') && !file.type.includes('csv')) {
      setError('Please select a valid CSV file')
      return
    }

    setSelectedFile(file)
    setError('')
    setParsedData(null)

    // Parse CSV file
    Papa.parse(file, {
      header: false,
      skipEmptyLines: 'greedy',
      delimiter: ';',
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const data = results.data as string[][]
          const fields = data[0] // First row as headers
          const rows = data.slice(1) // Rest as data rows

          setParsedData({ fields, rows })
        } else {
          setError('CSV file is empty')
        }
      },
      error: (error) => {
        setError(`Failed to parse CSV: ${error.message}`)
      },
    })
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">CSV to Pohoda Converter</h1>

      <FileUploader
        onFileSelect={handleFile}
        selectedFile={selectedFile}
        accept=".csv"
        error={error}
      />

      {parsedData && (
        <div className="mt-8">
          <h2 className="text-2xl font-semibold mb-4">CSV Preview</h2>
          <div className="border rounded-lg overflow-auto max-h-150">
            <table className="w-full border-collapse">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  {parsedData.fields.map((field, index) => (
                    <th
                      key={index}
                      className="border border-gray-300 px-4 py-2 text-left font-semibold"
                    >
                      {field}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedData.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-gray-50">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="border border-gray-300 px-4 py-2 whitespace-nowrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Showing {parsedData.rows.length} rows
          </p>
        </div>
      )}
    </div>
  )
}
