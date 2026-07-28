import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import RoomCanvas from './RoomCanvas.jsx'
import './App.css'

const ROOM_NAME_HEADER = 'Room Name'
const TARGET_AREA_HEADER = 'Target Area'
const ADJACENT_ROOMS_HEADER = 'Adjacent Rooms'

function normalizeHeader(value) {
    return String(value ?? '').trim().toLowerCase()
}

function parseAdjacentRooms(value) {
    const text = String(value ?? '').trim()
    if (!text) return {}

    return text.split(',').reduce((adjacentRooms, pair) => {
        const [name, distance] = pair.split(':')
        const trimmedName = name?.trim()
        if (!trimmedName || distance === undefined) return adjacentRooms

        adjacentRooms[trimmedName] = parseFloat(distance.trim())
        return adjacentRooms
    }, {})
}

function parseWorkbook(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    if (rows.length === 0) {
        throw new Error('The spreadsheet is empty.')
    }

    const [headerRow, ...dataRows] = rows
    const normalizedHeaders = headerRow.map(normalizeHeader)
    const roomNameIndex = normalizedHeaders.indexOf(normalizeHeader(ROOM_NAME_HEADER))
    const targetAreaIndex = normalizedHeaders.indexOf(normalizeHeader(TARGET_AREA_HEADER))
    const adjacentRoomsIndex = normalizedHeaders.indexOf(normalizeHeader(ADJACENT_ROOMS_HEADER))

    if (roomNameIndex === -1 || targetAreaIndex === -1 || adjacentRoomsIndex === -1) {
        throw new Error(
            `Could not find required columns "${ROOM_NAME_HEADER}", "${TARGET_AREA_HEADER}" and "${ADJACENT_ROOMS_HEADER}".`,
        )
    }

    const rooms = {}
    let nextId = 0
    dataRows
        .filter((row) => row[roomNameIndex] !== '' && row[roomNameIndex] !== undefined)
        .forEach((row) => {
            rooms[`room-${nextId++}`] = {
                roomName: String(row[roomNameIndex]),
                targetArea: parseFloat(row[targetAreaIndex]),
                adjacentRooms: parseAdjacentRooms(row[adjacentRoomsIndex]),
            }
        })
    return rooms
}

function App() {
    const [rooms, setRooms] = useState({})
    const [fileName, setFileName] = useState('')
    const [error, setError] = useState('')
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef(null)
    const [fileDropToggle, setDropToggle] = useState(true)

    const handleFile = useCallback((file) => {
        if (!file) return
        setError('')

        if (!/\.(xlsx|xls)$/i.test(file.name)) {
            setError('Please upload an Excel file (.xlsx or .xls).')
            return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const parsed = parseWorkbook(event.target.result)
                setRooms(parsed)
                setFileName(file.name)
            } catch (err) {
                setError(err.message)
                setRooms({})
                setFileName('')
            }
        }
        reader.onerror = () => setError('Failed to read the file.')
        reader.readAsArrayBuffer(file)
    }, [])

    const handleDrop = useCallback(
        (event) => {
            event.preventDefault()
            setIsDragging(false)
            handleFile(event.dataTransfer.files?.[0])
            setDropToggle(false)
        },
        [handleFile],
    )

    const handleDragOver = useCallback((event) => {
        event.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((event) => {
        event.preventDefault()
        setIsDragging(false)
    }, [])

    const handleBrowseClick = () => fileInputRef.current?.click()

    const handleFileInputChange = (event) => {
        handleFile(event.target.files?.[0])
        event.target.value = ''
    }

    const roomIds = Object.keys(rooms)
    const roomList = roomIds.map((id) => ({ id, ...rooms[id] }))

    return (
        <section id="center">
            <div>
                <h1 style={{ fontSize: '2rem' }}>Room Schedule Import</h1>
                {fileDropToggle && (
                    <p>
                        Drop an Excel file with <code>{ROOM_NAME_HEADER}</code>, <code>{TARGET_AREA_HEADER}</code> and{' '}
                        <code>{ADJACENT_ROOMS_HEADER}</code> columns headings to import<br></br>List adjacent rooms in with the format "ROOM NAME : MAX DISTANCE"<br></br>For multiple adjacency rules, list in the same cell seperated by a ","
                    </p>)}
            </div>
            {fileDropToggle && (
                <div
                    className={`dropzone${isDragging ? ' dropzone--active' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handleBrowseClick}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') handleBrowseClick()
                    }}
                >
                    <p>Drag &amp; drop an Excel file here, or click to browse</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileInputChange}
                        hidden
                    />
                </div>
            )}
            {!fileDropToggle && (
                <button 
                    onClick={() => setDropToggle(true)}>Upload another file
                </button>
            )}

            {fileName && !error && (
                <p className="filename">
                    Loaded {fileName} — {roomIds.length} room{roomIds.length === 1 ? '' : 's'}
                </p>
            )}
            {error && <p className="error">{error}</p>}

            <RoomCanvas rooms={roomList} />
        </section>
    )
}

export default App
