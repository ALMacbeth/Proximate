import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import RoomCanvas from './RoomCanvas.jsx'
import './App.css'

const ROOM_NAME_HEADER = 'Room Name'
const TARGET_AREA_HEADER = 'Target Area'
const ADJACENT_ROOMS_HEADER = 'Adjacent Rooms'
const MIN_WIDTH_HEADER = 'Min Width'

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

function extractFillColor(cell) {
    const rgb = cell?.s?.fgColor?.rgb
    if (!rgb || typeof rgb !== 'string' || rgb.length < 6) return undefined
    return `#${rgb.slice(-6)}`
}

function parseLayoutJson(text) {
    let data
    try {
        data = JSON.parse(text)
    } catch {
        throw new Error('That file is not valid saved layout file')
    }

    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('The layout file is empty or invalid.')
    }

    const rooms = {}
    data.forEach((room, index) => {
        if (typeof room?.roomName !== 'string') {
            throw new Error('The layout file does not look like an exported room layout.')
        }
        const id = typeof room.id === 'string' && room.id ? room.id : `room-${index}`
        const { id: _unused, ...rest } = room
        rooms[id] = rest
    })
    return rooms
}

function parseWorkbook(arrayBuffer) {
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true })
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
    const minWidthIndex = normalizedHeaders.indexOf(normalizeHeader(MIN_WIDTH_HEADER))

    if (roomNameIndex === -1 || targetAreaIndex === -1 || adjacentRoomsIndex === -1) {
        throw new Error(
            `Could not find required columns "${ROOM_NAME_HEADER}", "${TARGET_AREA_HEADER}" and "${ADJACENT_ROOMS_HEADER}".`,
        )
    }

    const roomNameColumn = XLSX.utils.encode_col(roomNameIndex)

    const rooms = {}
    let nextId = 0
    dataRows
        .map((row, index) => ({ row, excelRowNumber: index + 2 }))
        .filter(({ row }) => row[roomNameIndex] !== '' && row[roomNameIndex] !== undefined)
        .forEach(({ row, excelRowNumber }) => {
            const minWidthValue = minWidthIndex === -1 ? '' : row[minWidthIndex]
            const minWidth = minWidthValue === '' || minWidthValue === undefined ? undefined : parseFloat(minWidthValue)
            const roomNameCell = sheet[`${roomNameColumn}${excelRowNumber}`]

            rooms[`room-${nextId++}`] = {
                roomName: String(row[roomNameIndex]),
                targetArea: parseFloat(row[targetAreaIndex]),
                adjacentRooms: parseAdjacentRooms(row[adjacentRoomsIndex]),
                minWidth: Number.isFinite(minWidth) ? minWidth : undefined,
                color: extractFillColor(roomNameCell),
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

        const isExcel = /\.(xlsx|xls)$/i.test(file.name)
        const isLayoutJson = /\.json$/i.test(file.name)

        if (!isExcel && !isLayoutJson) {
            setError('Please upload an Excel file (.xlsx or .xls) or a previously exported layout (.json).')
            return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const parsed = isLayoutJson ? parseLayoutJson(event.target.result) : parseWorkbook(event.target.result)
                setRooms(parsed)
                setFileName(file.name)
            } catch (err) {
                setError(err.message)
                setRooms({})
                setFileName('')
            }
        }
        reader.onerror = () => setError('Failed to read the file.')

        if (isLayoutJson) reader.readAsText(file)
        else reader.readAsArrayBuffer(file)
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
                        <code>{ADJACENT_ROOMS_HEADER}</code> columns headings to import<br></br>List adjacent rooms in with the format "ROOM NAME : MAX DISTANCE"<br></br>For multiple adjacency rules, list in the same cell seperated by a ","<br></br>Optionally add a <code>{MIN_WIDTH_HEADER}</code> column (in meters) to set a minimum room width
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
                    <p>Drag &amp; drop an Excel file (or a previously exported layout file) here, or click to browse</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.json"
                        onChange={handleFileInputChange}
                        hidden
                    />
                </div>
            )}
            {!fileDropToggle && (
                <button 
                    onClick={() => setDropToggle(true)}>Upload a new file
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
