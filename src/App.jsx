import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import RoomCanvas from './RoomCanvas.jsx'
import './App.css'

const ROOM_NAME_HEADER = 'Room Name'
const TARGET_AREA_HEADER = 'Target Area'
const ADJACENT_ROOMS_HEADER = 'Adjacent Rooms'
const MIN_WIDTH_HEADER = 'Min Width'


function parseAdjacentRooms(value) {
    const text = String(value ?? '').trim()
    if (!text) return {}

    return text.split(',').reduce((adjacentRooms, pair) => {
        const [name, distance] = pair.split(':')
        const trimmedName = name?.trim()
        if (!trimmedName || distance === undefined) return {}

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
    const roomNameIndex = headerRow.indexOf(ROOM_NAME_HEADER)
    const targetAreaIndex = headerRow.indexOf(TARGET_AREA_HEADER)
    const adjacentRoomsIndex = headerRow.indexOf(ADJACENT_ROOMS_HEADER)
    const minWidthIndex = headerRow.indexOf(MIN_WIDTH_HEADER)

    if (roomNameIndex === -1 || targetAreaIndex === -1 || adjacentRoomsIndex === -1) {
        throw new Error(
            `Unable to load room data - Please ensure your file contains the following required column headers: "${ROOM_NAME_HEADER}", "${TARGET_AREA_HEADER}" and "${ADJACENT_ROOMS_HEADER}".`,
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
        setDropToggle(false)
    }

    const roomIds = Object.keys(rooms)
    const roomList = roomIds.map((id) => ({ id, ...rooms[id] }))

    return (
        <section id="center">
            <div>
                <h1 style={{ fontSize: '1.5rem' }}>Room Schedule Import</h1>
                {fileName && !error && (
                    <p className="filename">
                        Loaded {fileName} — {roomIds.length} room{roomIds.length === 1 ? '' : 's'} -&gt;
                        <button
                            onClick={() => setDropToggle(true)}>Upload a new file
                        </button>
                    </p>

                )}
                {fileDropToggle && (
                    <p style={{ fontSize:"12px" }}>
                        Drop an Excel file with <code style={{ fontSize: "12px" }}>{ROOM_NAME_HEADER}</code>, <code style={{ fontSize: "12px" }}>{TARGET_AREA_HEADER}</code> and{' '} <code style={{ fontSize: "12px" }}>{ADJACENT_ROOMS_HEADER}</code> columns headings to import<br>
                        </br>If any rooms have proximity requirements, list the nearby rooms in with the format <code style={{ fontSize: "12px" }}>{"Other Room Name : Max Distance"}</code><br>
                        </br>(For multiple adjacency rules, list in the same cell seperated by a <code style={{ fontSize: "12px" }}>{","}</code>)<br>
                        </br>If needed, you can add a <code style={{ fontSize: "12px" }}>{MIN_WIDTH_HEADER}</code> column to set a minimum room dimension.<br>
                        </br><br>
                        </br>Imported rooms will be displayed below as boxes which can be arranged by clicking and dragging.<br>
                        </br>These shapes can be adjusted in width and height while maintaining the target room area by clicking and dragging the handle in the bottom right corner.<br>
                        </br>Proximity requirements are highlighted as lines between rooms. If the distance between a room and the nearest instance of a target room is exceeded, those rooms are highlighted in red<br>
                        </br>To make the diagram easier to read, you can apply fills to the excel file rows and the imported rooms will be colored accordingly.<br>
                        </br>When you are happy with a layout, you can either save a layout file to be reloaded later, or export a scaled CAD file which can be loaded into the design software of your choice.<br>
                        </br>
                        <a href="./public/AreaScheduleTemplate.xlsx" download ><button> Download Excel Template </button></a>
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

            
            {error && <p className="error">{error}</p>}

            {!fileDropToggle && <RoomCanvas rooms={roomList} />}
        </section>
    )
}

export default App
