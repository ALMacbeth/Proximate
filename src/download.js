export function downloadFile(content, filename, mimeType) {
  const chosenName = window.prompt('Save file as:', filename)
  if (chosenName === null) return // user cancelled the prompt
  const finalName = chosenName.trim() || filename

  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = finalName
  link.click()
  URL.revokeObjectURL(url)
}
