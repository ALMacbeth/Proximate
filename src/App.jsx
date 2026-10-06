import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import RoomCanvas from './RoomCanvas.jsx'
import './App.css'

const ROOM_NAME_HEADER = 'Room Name'
const TARGET_AREA_HEADER = 'Target Area'
const ADJACENT_ROOMS_HEADER = 'Adjacent Rooms'
const MIN_WIDTH_HEADER = 'Min Width'
const COUNT_HEADER = 'Count'


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



function roomsArrayToMap(roomsArray) {
    const rooms = {}
    roomsArray.forEach((room, index) => {
        if (typeof room?.roomName !== 'string') {
            throw new Error('The layout file does not look like an exported room layout.')
        }
        const id = typeof room.id === 'string' && room.id ? room.id : `room-${index}`
        const { id: _unused, ...rest } = room
        rooms[id] = rest
    })
    return rooms
}

function parseLayoutJson(text) {
    let data
    try {
        data = JSON.parse(text)
    } catch {
        throw new Error('That file is not valid saved layout file')
    }


    if (Array.isArray(data)) {
        if (data.length === 0) throw new Error('The layout file is empty or invalid.')
        return { rooms: roomsArrayToMap(data), corridorNodes: [], corridorEdges: [], wallThicknessMm: undefined }
    }

    if (!Array.isArray(data?.rooms) || data.rooms.length === 0) {
        throw new Error('The layout file does not look like an exported room layout.')
    }

    return {
        rooms: roomsArrayToMap(data.rooms),
        corridorNodes: Array.isArray(data.corridorNodes) ? data.corridorNodes : [],
        corridorEdges: Array.isArray(data.corridorEdges) ? data.corridorEdges : [],
        wallThicknessMm: Number.isFinite(data.wallThicknessMm) ? data.wallThicknessMm : undefined,
    }
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
    const countIndex = headerRow.indexOf(COUNT_HEADER)

    if (roomNameIndex === -1 || targetAreaIndex === -1 || adjacentRoomsIndex === -1) {
        throw new Error(
            `Unable to load room data - Please ensure your file contains the following required column headers: "${ROOM_NAME_HEADER}", "${TARGET_AREA_HEADER}" and "${ADJACENT_ROOMS_HEADER}".`, 
        )
    }

    const roomNameColumn = XLSX.utils.encode_col(roomNameIndex)

    const rooms = {}
    let nextId = 0
    dataRows
        .map((row, index) => {
            // No column at all, or a blank cell, both mean "just the one
            // room" — only an explicit, parseable value changes the count.
            const countValue = countIndex === -1 ? undefined : row[countIndex]
            const parsedCount = countValue === '' || countValue === undefined ? 1 : parseFloat(countValue)
            const count = Number.isFinite(parsedCount) ? Math.round(parsedCount) : 1
            return { row, excelRowNumber: index + 2, targetArea: parseFloat(row[targetAreaIndex]), count }
        })
        .filter(({ row }) => row[roomNameIndex] !== '' && row[roomNameIndex] !== undefined)
        // A missing/blank cell parses to NaN; a zero or negative area isn't
        // a real room either — both would otherwise import as a degenerate,
        // effectively invisible box, so skip the row entirely.
        .filter(({ targetArea }) => Number.isFinite(targetArea) && targetArea > 0)
        // A Count of 0 (or negative) means the row is excluded outright —
        // distinct from a missing/blank value, which defaults to 1 above.
        .filter(({ count }) => count > 0)
        .forEach(({ row, excelRowNumber, targetArea, count }) => {
            const minWidthValue = minWidthIndex === -1 ? '' : row[minWidthIndex]
            const minWidth = minWidthValue === '' || minWidthValue === undefined ? undefined : parseFloat(minWidthValue)
            const roomNameCell = sheet[`${roomNameColumn}${excelRowNumber}`]
            const adjacentRooms = parseAdjacentRooms(row[adjacentRoomsIndex])
            const color = extractFillColor(roomNameCell)

            // Each instance is its own independent room sharing the same
            // name/area/adjacency/color — the app already treats repeated
            // room names as distinct instances everywhere else (auto-arrange
            // adjacency resolution, connection lines, keyword grouping all
            // resolve by name), so this is exactly the data shape they
            // already expect.
            for (let i = 0; i < count; i += 1) {
                rooms[`room-${nextId++}`] = {
                    roomName: String(row[roomNameIndex]),
                    targetArea,
                    adjacentRooms,
                    minWidth: Number.isFinite(minWidth) ? minWidth : undefined,
                    color,
                }
            }
        })
    return rooms
}



function App() {
    const [rooms, setRooms] = useState({})
    const [corridorNodes, setCorridorNodes] = useState([])
    const [corridorEdges, setCorridorEdges] = useState([])
    const [wallThicknessMm, setWallThicknessMm] = useState(undefined)
    const [underlayFile, setUnderlayFile] = useState(null)
    const [fileName, setFileName] = useState('')
    const [error, setError] = useState('')
    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef(null)
    const [fileDropToggle, setDropToggle] = useState(true)
    const [infoToggle, setInfoToggle] = useState(false)
    const [helpToggle, setHelpToggle] = useState(false)

    const handleFile = useCallback((file) => {
        if (!file) return
        setError('')

        const isExcel = /\.(xlsx|xls)$/i.test(file.name)
        const isLayoutJson = /\.json$/i.test(file.name)
        const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'


        if (isPdf) {
            setRooms({})
            setCorridorNodes([])
            setCorridorEdges([])
            setWallThicknessMm(undefined)
            setUnderlayFile(file)
            setFileName('')
            setDropToggle(false)
            return
        }

        if (!isExcel && !isLayoutJson) {
            setError('Please upload an Excel file (.xlsx or .xls), a previously exported layout (.json), or a PDF to use as a background underlay.')
            return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                if (isLayoutJson) {
                    const parsed = parseLayoutJson(event.target.result)
                    setRooms(parsed.rooms)
                    setCorridorNodes(parsed.corridorNodes)
                    setCorridorEdges(parsed.corridorEdges)
                    setWallThicknessMm(parsed.wallThicknessMm)
                } else {
                    setRooms(parseWorkbook(event.target.result))
                    setCorridorNodes([])
                    setCorridorEdges([])
                    setWallThicknessMm(undefined)
                }
                setFileName(file.name)
            } catch (err) {
                setError(err.message)
                setRooms({})
                setCorridorNodes([])
                setCorridorEdges([])
                setWallThicknessMm(undefined)
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
                <h1 >PROXIMATE</h1>
                {fileName && !error && (
                    <p className="filename">
                        Loaded {fileName} — {roomIds.length} room{roomIds.length === 1 ? '' : 's'} -&gt;
                        <button
                            onClick={() => setDropToggle(true)}>Upload a new file
                        </button>
                    </p>

                )}
                {fileDropToggle && (
                    <p style={{ fontSize: "18px" }}>
                        Quickly generate layout diagrams from area schedules<br></br>
                        <button onClick={() => setInfoToggle(!infoToggle)}>{infoToggle ? 'Hide Instructions' : 'Show Instructions'}</button>
                    </p>
                    
                )}
                {infoToggle && fileDropToggle &&(
                    <p style={{ fontSize: "14px" }}>
                        <br>
                        </br>Drop an Excel file with <code style={{ fontSize: "14px" }}>{ROOM_NAME_HEADER}</code>, <code style={{ fontSize: "14px" }}>{TARGET_AREA_HEADER}</code> and{' '} <code style={{ fontSize: "14px" }}>{ADJACENT_ROOMS_HEADER}</code> columns headings to import<br>
                        </br>If any rooms have proximity requirements, list the nearby rooms in with the format <code style={{ fontSize: "14px" }}>{"Other Room Name : Max Distance"}</code><br>
                        </br>(For multiple adjacency rules, list in the same cell seperated by a <code style={{ fontSize: "14px" }}>{","}</code>)<br>
                        </br>If needed, you can add a <code style={{ fontSize: "14px" }}>{MIN_WIDTH_HEADER}</code> column to set a minimum room dimension.<br>
                        </br>You can also add a <code style={{ fontSize: "14px" }}>{COUNT_HEADER}</code> column to import multiple instances of the same row at once — leave it blank for a single room, or use <code style={{ fontSize: "14px" }}>{"0"}</code> to skip that row entirely.<br>
                        </br><br>
                        </br>Imported rooms will be displayed below as boxes which can be arranged by clicking and dragging.<br>
                        </br>These shapes can be adjusted in width and height while maintaining the target room area by clicking and dragging the handle in the bottom right corner.<br>
                        </br>Proximity requirements are highlighted as lines between rooms. If the distance between a room and the nearest instance of a target room is exceeded, those rooms are highlighted in red<br>
                        </br>To make the diagram easier to read, you can apply fills to the excel file rows and the imported rooms will be colored accordingly.<br>
                        </br>When you are happy with a layout, you can either save a layout file to be reloaded later, or export a scaled CAD file which can be loaded into the design software of your choice.<br>
                        </br>
                        <a href="./AreaScheduleTemplate.xlsx" download ><button> Download Excel Template </button></a>
                    </p>)}
                {helpToggle && fileDropToggle && (
                    <div>
                        <p>If you have any questions about using this tool, please refer to the user guide <a href="https://miro.com/app/board/uXjVHrncD74=/?share_link_id=312980620673">here</a><br>
                        </br>If you encouter a bug or have a feature request, please contact: <a href="mailto:alex.macbeth@wwparchitects.com">alex.macbeth@wwparchitects.com</a>
                        </p>
                    </div>
                )}
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
                    <p>Drag &amp; drop an Excel file (or a previously exported layout file) here, or click to browse — a PDF can also be dropped to use as a background underlay</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.json,.pdf"
                        onChange={handleFileInputChange}
                        hidden
                    />
                </div>
            )}
            {fileDropToggle && (
                <button
                    className="info_button"

                    onClick={() => setHelpToggle(!helpToggle)}
                >
                    Help
                </button>)}
            
            {error && <p className="error">{error}
            <br>
                </br>
                <button
                onClick={() => setDropToggle(true) }>Upload a new file
            </button></p>}

            {!fileDropToggle && (
                <RoomCanvas
                    rooms={roomList}
                    corridorNodes={corridorNodes}
                    corridorEdges={corridorEdges}
                    initialUnderlayFile={underlayFile}
                    wallThicknessMm={wallThicknessMm}
                />

            )}
            
        </section>
        
    )
}

export default App
