import { qrPath } from './qr-svg.js'

const STORAGE_KEY = 'qr:url'

const input = document.getElementById('url')
const svg = document.getElementById('qr')
const path = document.getElementById('qr-path')
const error = document.getElementById('error')

function render(text) {
  error.textContent = ''

  if (!text) {
    svg.hidden = true
    return
  }

  try {
    const { d, side } = qrPath(text)
    svg.setAttribute('viewBox', `0 0 ${side} ${side}`)
    path.setAttribute('d', d)
    svg.hidden = false
  } catch (e) {
    svg.hidden = true
    error.textContent = e.message
  }
}

input.addEventListener('input', () => {
  localStorage.setItem(STORAGE_KEY, input.value)
  render(input.value.trim())
})

// Fall back to the default in the markup when nothing has been saved yet.
input.value = localStorage.getItem(STORAGE_KEY) ?? input.value
render(input.value.trim())
