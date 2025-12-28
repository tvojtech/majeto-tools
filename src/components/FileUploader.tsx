import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FileUploaderProps {
  onFileSelect: (file: File) => void
  selectedFile: File | null
  accept?: string
  error?: string
}

export function FileUploader({
  onFileSelect,
  selectedFile,
  accept = '.csv',
  error,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onFileSelect(file)
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file) {
      onFileSelect(file)
    }
  }

  return (
    <div className="mb-8">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center transition-colors
          ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-300'}
          ${selectedFile ? 'bg-green-50 border-green-300' : ''}
        `}
      >
        <div className="flex flex-col items-center gap-4">
          <svg
            className="w-16 h-16 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>

          <div>
            <p className="text-lg font-medium mb-2">
              {selectedFile ? (
                <span className="text-green-600">✓ {selectedFile.name}</span>
              ) : (
                'Drag & drop your CSV file here'
              )}
            </p>
            <p className="text-sm text-gray-500 mb-4">or</p>

            <label htmlFor="file-upload">
              <Button
                type="button"
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                Browse Files
              </Button>
            </label>
            <Input
              id="file-upload"
              type="file"
              accept={accept}
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
