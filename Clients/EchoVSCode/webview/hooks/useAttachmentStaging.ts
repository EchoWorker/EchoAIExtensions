/**
 * useAttachmentStaging — Generic attachment staging hook (image + any file).
 * Ported from EchoWork. Supports paste (screenshots + copied files) and drag-and-drop.
 * 10MB per-file size limit. Returns dataURI strings ready to send to gateway.
 */

import { useState, useCallback } from 'react'

export interface StagedAttachment {
  dataUri: string
  name: string
  /** 'image' renders as thumbnail; 'file' renders as icon + name */
  type: 'image' | 'file'
  mimeType: string
  size: number
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

export function useAttachmentStaging() {
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([])

  const stageFile = useCallback((file: File): boolean => {
    if (file.size > MAX_FILE_SIZE) {
      console.warn(`Rejected: ${file.name} (${formatBytes(file.size)} > 10MB limit)`)
      return false
    }
    const reader = new FileReader()
    reader.onload = () => {
      const att: StagedAttachment = {
        dataUri: reader.result as string,
        name: file.name,
        type: isImageMime(file.type) ? 'image' : 'file',
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      }
      setStagedAttachments((prev) => [...prev, att])
    }
    reader.readAsDataURL(file)
    return true
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setStagedAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearAttachments = useCallback(() => setStagedAttachments([]), [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const files = Array.from(e.clipboardData.files)

    // Image items (screenshots from clipboard)
    let handled = false
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) stageFile(file)
        handled = true
      }
    }

    // Files (Ctrl+C copied files)
    if (!handled && files.length > 0) {
      e.preventDefault()
      for (const file of files) stageFile(file)
    }
  }, [stageFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) stageFile(file)
  }, [stageFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return {
    stagedAttachments,
    stageFile,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDrop,
    handleDragOver,
  }
}
